package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
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
	_ backend.CallResourceHandler   = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

type settings struct {
	Endpoint             string `json:"endpoint"`
	TimeoutSeconds       int    `json:"timeoutSeconds"`
	MaxConcurrentQueries int    `json:"maxConcurrentQueries"`
}

type Datasource struct {
	client     *scopedb.Client
	httpClient *http.Client
	timeout    time.Duration
	apiKey     string
	configErr  error
	slots      chan struct{}
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
	if cfg.MaxConcurrentQueries == 0 {
		cfg.MaxConcurrentQueries = 4
	}
	if cfg.MaxConcurrentQueries < 1 || cfg.MaxConcurrentQueries > 32 {
		d.configErr = errors.New("Concurrent queries must be 1–32")
		return d, nil
	}
	d.slots = make(chan struct{}, cfg.MaxConcurrentQueries)
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
	return d.executeStatement(parent, text, uuid.New())
}

func (d *Datasource) executeStatement(parent context.Context, text string, id uuid.UUID) (result *scopedb.ResultSet, err error) {
	if d.configErr != nil {
		return nil, d.configErr
	}
	ctx, cancel := context.WithTimeout(parent, d.timeout)
	defer cancel()
	select {
	case d.slots <- struct{}{}:
		defer func() { <-d.slots }()
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	ctx = httpclient.WithResponseLimit(ctx, 16<<20)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	statement := d.client.Statement(text)
	statement.ID = &id
	statement.ExecTimeout = fmt.Sprintf("PT%dS", max(1, int(d.timeout.Seconds())))
	// Retain our ID even if submission times out after reaching the server.
	handle := d.client.StatementHandle(id)
	defer func() {
		if err == nil {
			return
		}
		var api *scopedb.Error
		if handle.LastStatus() == nil && errors.As(err, &api) && (api.HTTPStatus == 400 || api.HTTPStatus == 401 || api.HTTPStatus == 403 || api.HTTPStatus == 404) {
			return // A rejected submission has no running server job to cancel.
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
	Format       string `json:"format"`
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	response := backend.NewQueryDataResponse()
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, q := range req.Queries {
		wg.Add(1)
		go func(q backend.DataQuery) {
			defer wg.Done()
			result := d.query(ctx, q)
			mu.Lock()
			response.Responses[q.RefID] = result
			mu.Unlock()
		}(q)
	}
	wg.Wait()
	return response, nil
}

func (d *Datasource) query(ctx context.Context, q backend.DataQuery) backend.DataResponse {
	if d.configErr != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, d.safeError(d.configErr))
	}
	var qm queryModel
	if err := json.Unmarshal(q.JSON, &qm); err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Invalid query JSON")
	}
	if qm.Hide {
		return backend.DataResponse{}
	}
	if qm.ModelVersion > 2 {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Unsupported query model version")
	}
	if strings.TrimSpace(qm.QueryText) == "" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "ScopeQL query is empty")
	}
	if qm.Format != "" && qm.Format != "table" && qm.Format != "time_series" {
		return backend.ErrDataResponse(backend.StatusBadRequest, "Unknown result format; choose Table or Time series")
	}
	expanded, err := expandMacros(qm.QueryText, q)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, err.Error())
	}
	started := time.Now()
	id := uuid.New()
	rs, err := d.executeStatement(ctx, expanded, id)
	if err != nil {
		return backend.ErrDataResponse(errorStatus(err), d.safeError(err)+" (query "+id.String()+")")
	}
	frame, err := toFrame(q.RefID, rs)
	if err != nil {
		return backend.ErrDataResponse(backend.StatusBadRequest, d.safeError(err))
	}
	frames := data.Frames{frame}
	if qm.Format == "time_series" {
		if err := validateSeriesTypes(rs.Schema, frame); err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, err.Error())
		}
		frames, err = timeSeriesFrames(frame)
		if err != nil {
			return backend.ErrDataResponse(backend.StatusBadRequest, d.safeError(err))
		}
	}
	for _, f := range frames {
		f.Meta.ExecutedQueryString = expanded
		f.Meta.Custom = map[string]any{"queryId": id.String(), "durationMs": time.Since(started).Milliseconds(), "rows": rs.TotalRows, "intervalMs": queryInterval(q).Milliseconds()}
	}
	return backend.DataResponse{Frames: frames}
}

func errorStatus(err error) backend.Status {
	if errors.Is(err, context.DeadlineExceeded) {
		return backend.StatusTimeout
	}
	if errors.Is(err, context.Canceled) {
		return backend.Status(499)
	}
	var api *scopedb.Error
	if errors.As(err, &api) {
		if api.StatementDetails != nil && (api.StatementDetails.Code == scopedb.StatementErrorCodeExecutionTimeout || api.StatementDetails.Code == scopedb.StatementErrorCodePendingTimeout) {
			return backend.StatusTimeout
		}
		if api.HTTPStatus >= 400 && api.HTTPStatus <= 599 {
			return backend.Status(api.HTTPStatus)
		}
		if api.Kind == scopedb.ErrorKindStatementFailed || api.Kind == scopedb.ErrorKindConfigInvalid {
			return backend.StatusBadRequest
		}
	}
	return backend.StatusBadGateway
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
		message := d.safeError(err)
		var api *scopedb.Error
		var network *url.Error
		switch {
		case errors.As(err, &api) && (api.HTTPStatus == 401 || api.HTTPStatus == 403):
			message = "Authentication failed. Check the API key and its access to this workspace."
		case errors.Is(err, context.DeadlineExceeded):
			message = "Connection test timed out. Check the endpoint and network access, or increase the timeout under Advanced."
		case errors.As(err, &network):
			message = "Cannot reach ScopeDB. Check the endpoint and network access from the Grafana server."
		}
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: message}, nil
	}
	return &backend.CheckHealthResult{Status: backend.HealthStatusOk, Message: "ScopeDB connected; SELECT 1 AS ok succeeded"}, nil
}
