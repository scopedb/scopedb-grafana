package plugin

import (
	"fmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var columnReference = regexp.MustCompile("^(?:[A-Za-z_][A-Za-z_0-9]*|`(?:[^`\\\\]|\\\\.)+`)(?:\\.(?:[A-Za-z_][A-Za-z_0-9]*|`(?:[^`\\\\]|\\\\.)+`))*$")

func expandTimeFilter(query string, from, to time.Time) (string, error) {
	return expandMacros(query, backend.DataQuery{TimeRange: backend.TimeRange{From: from, To: to}})
}

func queryInterval(q backend.DataQuery) time.Duration {
	points := q.MaxDataPoints
	if points < 2 {
		points = 1000
	}
	points = min(points, 10000)
	span := q.TimeRange.To.Sub(q.TimeRange.From)
	needed := time.Duration(0)
	if span > 0 {
		needed = span / time.Duration(points-1)
		if span%time.Duration(points-1) != 0 {
			needed++
		}
	}
	wanted := max(time.Second, q.Interval, needed)
	for _, seconds := range []int64{1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400, 604800, 2592000} {
		if d := time.Duration(seconds) * time.Second; d >= wanted {
			return d
		}
	}
	return min(wanted, 365*24*time.Hour)
}

func quotedEnd(s string, i int) int {
	quote := s[i]
	for j := i + 1; j < len(s); j++ {
		if s[j] == '\\' {
			j++
			continue
		}
		if s[j] == quote {
			if j+1 < len(s) && s[j+1] == quote {
				j++
				continue
			}
			return j + 1
		}
	}
	return len(s)
}

func macroArgs(query string, start int) ([]string, int, error) {
	args := []string{}
	part := start
	for i := start; i < len(query); i++ {
		switch query[i] {
		case '\'', '"', '`':
			i = quotedEnd(query, i) - 1
		case ',':
			args = append(args, strings.TrimSpace(query[part:i]))
			part = i + 1
		case ')':
			if i > part || len(args) > 0 {
				args = append(args, strings.TrimSpace(query[part:i]))
			}
			return args, i + 1, nil
		case '(':
			return nil, 0, fmt.Errorf("macro arguments must be column references or a fixed interval")
		}
	}
	return nil, 0, fmt.Errorf("unclosed ScopeDB macro")
}

// Replace macros only outside quoted literals, identifiers and comments.
func expandMacros(query string, q backend.DataQuery) (string, error) {
	interval := queryInterval(q)
	var out strings.Builder
	for i := 0; i < len(query); {
		start := i
		if query[i] == '\'' || query[i] == '"' || query[i] == '`' {
			i = quotedEnd(query, i)
			out.WriteString(query[start:i])
			continue
		}
		if strings.HasPrefix(query[i:], "--") {
			for i < len(query) && query[i] != '\n' {
				i++
			}
			out.WriteString(query[start:i])
			continue
		}
		if strings.HasPrefix(query[i:], "/*") {
			depth := 1
			i += 2
			for i < len(query) && depth > 0 {
				if strings.HasPrefix(query[i:], "/*") {
					depth++
					i += 2
				} else if strings.HasPrefix(query[i:], "*/") {
					depth--
					i += 2
				} else {
					i++
				}
			}
			out.WriteString(query[start:i])
			continue
		}
		if strings.HasPrefix(query[i:], "$__") {
			i += 3
			for i < len(query) && (query[i] >= 'a' && query[i] <= 'z' || query[i] >= 'A' && query[i] <= 'Z' || query[i] >= '0' && query[i] <= '9' || query[i] == '_') {
				i++
			}
			name := query[start:i]
			if name == "$__interval_ms" {
				out.WriteString(strconv.FormatInt(interval.Milliseconds(), 10))
				continue
			}
			if name == "$__interval" {
				fmt.Fprintf(&out, "%d::interval", interval.Nanoseconds())
				continue
			}
			if name != "$__timeFilter" && name != "$__timeGroup" && name != "$__timeFrom" && name != "$__timeTo" {
				return "", fmt.Errorf("unsupported macro %s; use $__timeFilter, $__timeGroup, $__timeFrom(), $__timeTo(), $__interval or $__interval_ms", name)
			}
			if i == len(query) || query[i] != '(' {
				return "", fmt.Errorf("%s requires parentheses", name)
			}
			args, end, err := macroArgs(query, i+1)
			if err != nil {
				return "", err
			}
			i = end
			if !q.TimeRange.From.Before(q.TimeRange.To) {
				return "", fmt.Errorf("time range must have from < to")
			}
			timestamp := func(t time.Time) string { return "'" + t.UTC().Format(time.RFC3339Nano) + "'::timestamp" }
			if name == "$__timeFrom" || name == "$__timeTo" {
				if len(args) != 0 {
					return "", fmt.Errorf("%s takes no arguments", name)
				}
				if name == "$__timeFrom" {
					out.WriteString(timestamp(q.TimeRange.From))
				} else {
					out.WriteString(timestamp(q.TimeRange.To))
				}
				continue
			}
			if len(args) < 1 || len(args) > 2 || !columnReference.MatchString(args[0]) {
				return "", fmt.Errorf("%s requires a column reference (backtick quoting is supported)", name)
			}
			col := args[0]
			if name == "$__timeFilter" {
				if len(args) != 1 {
					return "", fmt.Errorf("$__timeFilter takes one column argument")
				}
				fmt.Fprintf(&out, "(%s >= %s AND %s < %s)", col, timestamp(q.TimeRange.From), col, timestamp(q.TimeRange.To))
				continue
			}
			bucket := interval
			if len(args) == 2 {
				arg := args[1]
				if len(arg) < 3 || arg[0] != '\'' || arg[len(arg)-1] != '\'' {
					return "", fmt.Errorf("fixed interval must be a quoted duration, e.g. '5m'")
				}
				bucket, err = time.ParseDuration(arg[1 : len(arg)-1])
				if err != nil || bucket < time.Millisecond || bucket > 365*24*time.Hour {
					return "", fmt.Errorf("fixed interval must be between 1ms and 8760h; use h for durations longer than a day")
				}
			}
			// A double remainder floors timestamps before the Unix epoch too.
			ns := bucket.Nanoseconds()
			fmt.Fprintf(&out, "(%s::int - ((%s::int %% %d + %d) %% %d))::timestamp", col, col, ns, ns, ns)
			continue
		}
		if query[i] == '$' && i+1 < len(query) && (query[i+1] == '{' || query[i+1] >= 'a' && query[i+1] <= 'z' || query[i+1] >= 'A' && query[i+1] <= 'Z') {
			return "", fmt.Errorf("unresolved Dashboard variable; use the Grafana query editor to interpolate variables")
		}
		out.WriteByte(query[i])
		i++
	}
	return out.String(), nil
}
