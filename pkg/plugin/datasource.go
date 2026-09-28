package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	scopedb "github.com/scopedb/goscopedb"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

type settings struct {
	Endpoint       string `json:"endpoint"`
	TimeoutSeconds int    `json:"timeoutSeconds"`
}

type Datasource struct {
	client     *scopedb.Client
	httpClient *http.Client
	timeout    time.Duration
	apiKey     string
	configErr  error
}

func NewDatasource(ctx context.Context, s backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	d := &Datasource{apiKey: s.DecryptedSecureJSONData["apiKey"]}
	var cfg settings
	if err := json.Unmarshal(s.JSONData, &cfg); err != nil {
		d.configErr = errors.New("invalid datasource settings")
		return d, nil
	}
	u, err := url.Parse(strings.TrimSpace(cfg.Endpoint))
	if err != nil || u.Hostname() == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		d.configErr = errors.New("Endpoint must be an HTTP(S) URL without credentials, query, or fragment")
		return d, nil
	}
	if d.apiKey == "" {
		d.configErr = errors.New("API key is missing")
		return d, nil
	}
	if cfg.TimeoutSeconds == 0 {
		cfg.TimeoutSeconds = 30
	}
	if cfg.TimeoutSeconds < 1 || cfg.TimeoutSeconds > 300 {
		d.configErr = errors.New("Timeout must be 1–300 seconds")
		return d, nil
	}
	d.timeout = time.Duration(cfg.TimeoutSeconds) * time.Second
	opts, err := s.HTTPClientOptions(ctx)
	if err != nil {
		return nil, err
	}
	hc, err := httpclient.New(opts)
	if err != nil {
		return nil, err
	}
	hc.Timeout = d.timeout
	hc.CheckRedirect = func(*http.Request, []*http.Request) error {
		return errors.New("ScopeDB endpoint redirects are not supported")
	}
	d.httpClient = hc
	d.client, err = scopedb.NewClient(scopedb.Config{Endpoint: strings.TrimRight(u.String(), "/"), APIKey: d.apiKey, HTTPClient: hc})
	if err != nil {
		hc.CloseIdleConnections()
		return nil, err
	}
	return d, nil
}

func (d *Datasource) Dispose() {
	if d.client != nil {
		d.client.Close()
	}
	if d.httpClient != nil {
		d.httpClient.CloseIdleConnections()
	}
}

func (d *Datasource) execute(parent context.Context, text string) (result *scopedb.ResultSet, err error) {
	if d.configErr != nil {
		return nil, d.configErr
	}
	ctx, cancel := context.WithTimeout(parent, d.timeout)
	defer cancel()
	ctx = httpclient.WithResponseLimit(ctx, 16<<20)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	statement := d.client.Statement(text)
	id := uuid.New()
	statement.ID = &id
	statement.ExecTimeout = fmt.Sprintf("PT%dS", max(1, int(d.timeout.Seconds())))
	// Retain our ID even if submission times out after reaching the server.
	handle := d.client.StatementHandle(id)
	defer func() {
		if err == nil {
			return
		}
		if status := handle.LastStatus(); status != nil && status.Terminated() {
			return
		}
		cleanup, stop := context.WithTimeout(context.Background(), 2*time.Second)
		defer stop()
		outcome, cancelErr := handle.Cancel(cleanup)
		if cancelErr != nil || !outcome.Status.Terminated() {
			err = fmt.Errorf("%w; server cancellation could not be confirmed", err)
		}
	}()
	submitted, err := statement.Submit(ctx)
	if err != nil {
		return nil, err
	}
	handle = submitted
	// SDK Wait performs bounded backoff Status polling and propagates terminal failures.
	return handle.Wait(ctx)
}

func (d *Datasource) safeError(err error) string {
	msg := err.Error()
	if errors.Is(err, context.DeadlineExceeded) {
		msg = "ScopeDB query timed out: " + msg
	}
	if errors.Is(err, context.Canceled) {
		msg = "ScopeDB query cancelled: " + msg
	}
	if d.apiKey != "" {
		msg = strings.ReplaceAll(msg, d.apiKey, "[redacted]")
	}
	if len(msg) > 2000 {
		msg = msg[:2000] + "…"
	}
	return msg
}

type queryModel struct {
	QueryText    string `json:"queryText"`
	ModelVersion int    `json:"modelVersion"`
	Hide         bool   `json:"hide"`
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	for _, q := range req.Queries {
		response.Responses[q.RefID] = d.query(ctx, q)
	}
	return response, nil
}

func (d *Datasource) query(ctx context.Context, q backend.DataQuery) backend.DataResponse {
	var qm queryModel
	if err := json.Unmarshal(q.JSON, &qm); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Invalid query JSON")
	}
	if qm.Hide {
		return backend.DataResponse{}
	}
	if qm.ModelVersion > 1 {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Unsupported query model version")
	}
	if strings.TrimSpace(qm.QueryText) == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "ScopeQL query is empty")
	}
	expanded, err := expandTimeFilter(qm.QueryText, q.TimeRange.From, q.TimeRange.To)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, err.Error())
	}
	rs, err := d.execute(ctx, expanded)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, d.safeError(err))
	}
	frame, err := toFrame(q.RefID, rs)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, d.safeError(err))
	}
	return backend.DataResponse{Frames: data.Frames{frame}}
}

func (d *Datasource) CheckHealth(ctx context.Context, _ *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	result, err := d.execute(ctx, "SELECT 1 AS ok")
	if err == nil {
		var rows [][]*string
		rows, err = result.RawRows()
		if err == nil && (len(rows) != 1 || len(rows[0]) != 1 || rows[0][0] == nil || *rows[0][0] != "1") {
			err = errors.New("Unexpected response to SELECT 1 AS ok")
		}
	}
	if err != nil {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: d.safeError(err)}, nil
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "ScopeDB connected; SELECT 1 AS ok succeeded"}, nil
}
