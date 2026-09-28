package plugin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/klauspost/compress/zstd"
	"github.com/stretchr/testify/require"
)

const testID = "01989a4e-4ee2-7e63-87a5-65ac3b5161dc"

func envelope(status, extra string) string {
	return fmt.Sprintf(`{"statement_id":"%s","status":"%s","created_at":"2026-09-28T00:00:00Z","progress":{}%s}`, testID, status, extra)
}

func testDS(t *testing.T, handler http.HandlerFunc) *Datasource {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	cfg, _ := json.Marshal(settings{Endpoint: server.URL, TimeoutSeconds: 1})
	instance, err := NewDatasource(context.Background(), backend.DataSourceInstanceSettings{JSONData: cfg, DecryptedSecureJSONData: map[string]string{"apiKey": "test-secret"}})
	require.NoError(t, err)
	ds := instance.(*Datasource)
	require.NoError(t, ds.configErr)
	t.Cleanup(ds.Dispose)
	return ds
}

func TestFrameTypesAndNulls(t *testing.T) {
	ds := testDS(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/statements", r.URL.Path)
		require.Equal(t, "Bearer test-secret", r.Header.Get("Authorization"))
		fmt.Fprint(w, envelope("finished", `,"result_set":{"metadata":{"fields":[{"name":"time","data_type":"timestamp"},{"name":"n","data_type":"int"},{"name":"active","data_type":"boolean"},{"name":"big","data_type":"uint"},{"name":"obj","data_type":"object"},{"name":"ratio","data_type":"float"}],"num_rows":2},"format":"json","rows":[["2026-09-28T08:00:00+08:00","2","true","18446744073709551615","{\"a\":1}","1.5"],[null,null,null,null,null,null]]}`))
	})
	rs, err := ds.execute(context.Background(), "test query")
	require.NoError(t, err)
	f, err := toFrame("A", rs)
	require.NoError(t, err)
	require.Equal(t, "A", f.RefID)
	require.Equal(t, []data.FieldType{data.FieldTypeNullableTime, data.FieldTypeNullableFloat64, data.FieldTypeNullableBool, data.FieldTypeNullableString, data.FieldTypeNullableString, data.FieldTypeNullableFloat64},
		[]data.FieldType{f.Fields[0].Type(), f.Fields[1].Type(), f.Fields[2].Type(), f.Fields[3].Type(), f.Fields[4].Type(), f.Fields[5].Type()})
	for _, field := range f.Fields {
		require.True(t, field.NilAt(1))
	}
	require.Equal(t, "18446744073709551615", *f.Fields[3].At(0).(*string))
	require.Equal(t, time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC), *f.Fields[0].At(0).(*time.Time))
}

func TestResultValidation(t *testing.T) {
	for _, tc := range []struct{ name, extra, want string }{
		{"empty", `,"result_set":{"metadata":{"fields":[{"name":"n","data_type":"int"}],"num_rows":0},"format":"json","rows":[]}`, ""},
		{"width", `,"result_set":{"metadata":{"fields":[{"name":"n","data_type":"int"}],"num_rows":1},"format":"json","rows":[[]]}`, "column count"},
		{"count", `,"result_set":{"metadata":{"fields":[],"num_rows":1},"format":"json","rows":[]}`, "row count"},
		{"limit", `,"result_set":{"metadata":{"fields":[],"num_rows":10001},"format":"json","rows":[]}`, "10,000"},
		{"bad type", `,"result_set":{"metadata":{"fields":[{"name":"n","data_type":"int"}],"num_rows":1},"format":"json","rows":[["oops"]]}`, "invalid int"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ds := testDS(t, func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, envelope("finished", tc.extra)) })
			rs, err := ds.execute(context.Background(), "test")
			require.NoError(t, err)
			f, err := toFrame("A", rs)
			if tc.want == "" {
				require.NoError(t, err)
				require.Equal(t, 0, f.Rows())
			} else {
				require.ErrorContains(t, err, tc.want)
			}
		})
	}
}

func TestLifecycle(t *testing.T) {
	for _, mode := range []string{"success", "failed", "server-cancelled", "timeout", "caller-cancel", "lost-submit", "cancel-failed"} {
		t.Run(mode, func(t *testing.T) {
			var polls, cancels atomic.Int32
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			ds := testDS(t, func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/cancel") {
					cancels.Add(1)
					require.NoError(t, r.Context().Err(), "cleanup must use a fresh context")
					if mode == "cancel-failed" {
						w.WriteHeader(500)
						fmt.Fprint(w, `{"message":"failed cleanup"}`)
						return
					}
					fmt.Fprint(w, envelope("cancelled", `,"message":"cancelled"`))
					return
				}
				if r.Method == "POST" {
					decoder, err := zstd.NewReader(r.Body)
					require.NoError(t, err)
					defer decoder.Close()
					var body map[string]any
					require.NoError(t, json.NewDecoder(decoder).Decode(&body))
					require.NotEmpty(t, body["statement_id"])
					require.Equal(t, "PT1S", body["exec_timeout"])
					if mode == "lost-submit" {
						<-r.Context().Done()
						return
					}
					fmt.Fprint(w, envelope("running", ""))
					return
				}
				polls.Add(1)
				switch mode {
				case "success":
					fmt.Fprint(w, envelope("finished", `,"result_set":{"metadata":{"fields":[{"name":"ok","data_type":"int"}],"num_rows":1},"format":"json","rows":[["1"]]}`))
				case "failed":
					fmt.Fprint(w, envelope("failed", `,"message":"syntax test-secret error"`))
				case "server-cancelled":
					fmt.Fprint(w, envelope("cancelled", `,"message":"server cancelled"`))
				default:
					if mode == "caller-cancel" {
						cancel()
					}
					fmt.Fprint(w, envelope("running", ""))
				}
			})
			ds.timeout = 80 * time.Millisecond
			result, err := ds.execute(ctx, "SELECT 1 AS ok")
			switch mode {
			case "success":
				require.NoError(t, err)
				require.NotNil(t, result)
				require.Zero(t, cancels.Load())
			case "failed", "server-cancelled":
				require.Error(t, err)
				require.Zero(t, cancels.Load())
				require.NotContains(t, ds.safeError(err), "test-secret")
			default:
				require.Error(t, err)
				require.Equal(t, int32(1), cancels.Load())
				if mode == "caller-cancel" {
					require.True(t, errors.Is(err, context.Canceled))
				} else {
					require.True(t, errors.Is(err, context.DeadlineExceeded))
				}
				if mode == "cancel-failed" {
					require.Contains(t, err.Error(), "could not be confirmed")
				}
			}
		})
	}
}

func TestErrorsStayOnTheirRefID(t *testing.T) {
	ds := testDS(t, func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, envelope("finished", `,"result_set":{"metadata":{"fields":[{"name":"ok","data_type":"int"}],"num_rows":1},"format":"json","rows":[["1"]]}`))
	})
	res, err := ds.QueryData(context.Background(), &backend.QueryDataRequest{Queries: []backend.DataQuery{
		{RefID: "A", JSON: json.RawMessage(`{"queryText":"SELECT 1 AS ok"}`)},
		{RefID: "B", JSON: json.RawMessage(`{"queryText":""}`)},
	}})
	require.NoError(t, err)
	require.Len(t, res.Responses["A"].Frames, 1)
	require.Error(t, res.Responses["B"].Error)
}
