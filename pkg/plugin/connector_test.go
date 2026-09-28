package plugin

import (
	"context"
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAdaptiveMacros(t *testing.T) {
	from := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	q := backend.DataQuery{TimeRange: backend.TimeRange{From: from, To: from.Add(time.Hour)}, MaxDataPoints: 100, Interval: time.Second}
	require.Equal(t, time.Minute, queryInterval(q))
	q.TimeRange.To = from.Add(7 * 24 * time.Hour)
	require.GreaterOrEqual(t, queryInterval(q), 2*time.Hour)
	result, err := expandMacros("SELECT $__timeFrom(), $__timeTo(), $__interval_ms, $__interval, $__timeGroup(`event time`, '5m')", q)
	require.NoError(t, err)
	require.NotContains(t, result, "$__")
	require.Contains(t, result, "300000000000")
	result, err = expandMacros("/* $__bad /* nested */ comment */ '$__bad' -- $__bad\n$__timeGroup(event_time)", q)
	require.NoError(t, err)
	require.Contains(t, result, "'$__bad'")
	for _, sql := range []string{"$__timeGroup(time, '0s')", "$__timeGroup(time, '1d')", "$__timeGroup(time, $x)", "$__timeFrom(time)", "$__timeFilter(time, '1m')", "$__timeGroup(time); $language"} {
		_, err = expandMacros(sql, q)
		require.Error(t, err, sql)
	}
}

func pointer[T any](v T) *T { return &v }
func TestTimeSeriesDimensions(t *testing.T) {
	start := time.Date(2026, 9, 28, 0, 0, 0, 0, time.UTC)
	frame := data.NewFrame("ScopeDB",
		data.NewField("time", nil, []*time.Time{pointer(start.Add(time.Minute)), pointer(start), pointer(start)}),
		data.NewField("service", nil, []*string{pointer("api"), pointer("worker"), pointer("api")}),
		data.NewField("value", nil, []*float64{nil, pointer(4.0), pointer(1.0)}))
	frame.RefID = "A"
	frames, err := timeSeriesFrames(frame)
	require.NoError(t, err)
	require.Len(t, frames, 2)
	for _, f := range frames {
		require.Equal(t, "A", f.RefID)
		require.Equal(t, data.FrameTypeTimeSeriesMulti, f.Meta.Type)
	}
	api := frames[1]
	require.Equal(t, "api", api.Fields[1].Labels["service"])
	require.Equal(t, start, api.Fields[0].At(0))
	require.Equal(t, start.Add(time.Minute), api.Fields[0].At(1))
	require.True(t, api.Fields[1].NilAt(1))
	frame.Fields[0].Set(0, pointer(start))
	_, err = timeSeriesFrames(frame)
	require.ErrorContains(t, err, "duplicate timestamp")
	frame.Fields[0].Set(0, (*time.Time)(nil))
	_, err = timeSeriesFrames(frame)
	require.ErrorContains(t, err, "cannot be NULL")
	empty := data.NewFrame("ScopeDB", data.NewField("time", nil, []*time.Time{}), data.NewField("n", nil, []*float64{}))
	frames, err = timeSeriesFrames(empty)
	require.NoError(t, err)
	require.Len(t, frames, 1)
	require.Equal(t, 0, frames[0].Rows())
	_, err = timeSeriesFrames(data.NewFrame("ScopeDB", data.NewField("text", nil, []*string{})))
	require.ErrorContains(t, err, "timestamp")
}

func TestCatalogRoutesAndErrors(t *testing.T) {
	ds := testDS(t, func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer test-secret", r.Header.Get("Authorization"))
		require.Equal(t, "500", r.URL.Query().Get("page_size"))
		require.Equal(t, "cursor", r.URL.Query().Get("page_token"))
		fmt.Fprint(w, `{"items":[{"name":"analytics","comment":null}],"next_page_token":"next"}`)
	})
	recorder := httptest.NewRecorder()
	ds.handleResource(recorder, httptest.NewRequest("GET", "/databases?pageToken=cursor", nil))
	require.Equal(t, 200, recorder.Code)
	require.Contains(t, recorder.Body.String(), "analytics")
	require.Contains(t, recorder.Body.String(), "next")
	for _, tc := range []struct {
		method, path string
		status       int
	}{{"POST", "/databases", 405}, {"GET", "/columns", 400}, {"GET", "/unknown", 404}} {
		r := httptest.NewRecorder()
		ds.handleResource(r, httptest.NewRequest(tc.method, tc.path, nil))
		require.Equal(t, tc.status, r.Code)
	}
}

func TestQueueTimeoutDoesNotSubmitOrCancel(t *testing.T) {
	ds := testDS(t, func(w http.ResponseWriter, r *http.Request) { t.Error("queued query must not issue HTTP requests") })
	for i := 0; i < cap(ds.slots); i++ {
		ds.slots <- struct{}{}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := ds.execute(ctx, "SELECT 1")
	require.ErrorIs(t, err, context.DeadlineExceeded)
	require.NotContains(t, err.Error(), "cancellation")
	require.Equal(t, backend.StatusTimeout, errorStatus(err))
}

func TestSeriesGroupLimit(t *testing.T) {
	times, labels, values := []*time.Time{}, []*string{}, []*float64{}
	for i := 0; i < 501; i++ {
		times = append(times, pointer(time.Now()))
		labels = append(labels, pointer(fmt.Sprint(i)))
		values = append(values, pointer(1.0))
	}
	_, err := timeSeriesFrames(data.NewFrame("ScopeDB", data.NewField("time", nil, times), data.NewField("label", nil, labels), data.NewField("value", nil, values)))
	require.Error(t, err)
	require.True(t, strings.Contains(err.Error(), "500"))
}

func TestParallelQueriesRespectInstanceLimit(t *testing.T) {
	entered := make(chan struct{}, 4)
	release := make(chan struct{})
	ds := testDS(t, func(w http.ResponseWriter, r *http.Request) {
		entered <- struct{}{}
		<-release
		fmt.Fprint(w, envelope("finished", `,"result_set":{"metadata":{"fields":[{"name":"n","data_type":"int"}],"num_rows":1},"format":"json","rows":[["1"]]}`))
	})
	ds.slots = make(chan struct{}, 2)
	done := make(chan *backend.QueryDataResponse, 1)
	go func() {
		req := &backend.QueryDataRequest{}
		for _, ref := range []string{"A", "B", "C", "D"} {
			req.Queries = append(req.Queries, backend.DataQuery{RefID: ref, JSON: []byte(`{"queryText":"SELECT 1 AS n"}`)})
		}
		response, _ := ds.QueryData(context.Background(), req)
		done <- response
	}()
	defer closeIfOpen(release)
	for i := 0; i < 2; i++ {
		select {
		case <-entered:
		case <-time.After(time.Second):
			t.Fatal("queries did not start concurrently")
		}
	}
	select {
	case <-entered:
		t.Fatal("instance limit exceeded")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	select {
	case result := <-done:
		require.Len(t, result.Responses, 4)
		for _, response := range result.Responses {
			require.NoError(t, response.Error)
		}
	case <-time.After(time.Second):
		t.Fatal("queries did not finish")
	}
}

func closeIfOpen(ch chan struct{}) {
	select {
	case <-ch:
	default:
		close(ch)
	}
}
