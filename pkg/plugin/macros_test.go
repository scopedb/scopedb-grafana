package plugin

import (
	"strings"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/require"
)

func TestTimeFilter(t *testing.T) {
	from := time.Date(2026, 9, 28, 8, 0, 0, 123, time.FixedZone("CST", 8*3600))
	to := from.Add(time.Hour)
	query := "FROM events WHERE $__timeFilter(event_time) AND $__timeFilter(e.time)"
	result, err := expandTimeFilter(query, from, to)
	require.NoError(t, err)
	require.Contains(t, result, "event_time >= '2026-09-28T00:00:00.000000123Z'::timestamp")
	require.Contains(t, result, "e.time < '2026-09-28T01:00:00.000000123Z'::timestamp")
	require.NotContains(t, result, "$__")
	for _, quoted := range []string{
		"'$__timeFilter(x)'", "\"$__timeFilter(x)\"", "`$__timeFilter(x)`",
		"'it''s $__timeFilter(x)'", "'a\\' $__timeFilter(x)'",
		"-- $__timeFilter(x)\n", "/* $__timeFilter(x) */", "SELECT $0",
	} {
		result, err := expandTimeFilter(quoted, from, to)
		require.NoError(t, err)
		require.Equal(t, quoted, result)
	}
	for _, invalid := range []string{"$__timeFilter(x+1)", "$__timeFilter(x); $__oops()", "$__timeFilter(x", "$__timeFilter('x')", "$__timeFilter()"} {
		_, err := expandTimeFilter(invalid, from, to)
		require.Error(t, err, invalid)
	}
	_, err = expandTimeFilter("$__timeFilter(x)", to, from)
	require.Error(t, err)
	result, err = expandTimeFilter("--comment\n$__timeFilter(x)", from, to)
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(result, "--comment\n("))
}

func expandTimeFilter(query string, from, to time.Time) (string, error) {
	return expandMacros(query, backend.DataQuery{TimeRange: backend.TimeRange{From: from, To: to}})
}

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
