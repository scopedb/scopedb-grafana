package plugin

import (
	"fmt"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
)

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

func TestSeriesGroupLimit(t *testing.T) {
	times, labels, values := []*time.Time{}, []*string{}, []*float64{}
	for i := 0; i < 501; i++ {
		times = append(times, pointer(time.Now()))
		labels = append(labels, pointer(fmt.Sprint(i)))
		values = append(values, pointer(1.0))
	}
	_, err := timeSeriesFrames(data.NewFrame("ScopeDB", data.NewField("time", nil, times), data.NewField("label", nil, labels), data.NewField("value", nil, values)))
	require.ErrorContains(t, err, "500")
}
