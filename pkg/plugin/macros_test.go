package plugin

import (
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
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
