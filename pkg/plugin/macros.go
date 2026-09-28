package plugin

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

var columnReference = regexp.MustCompile(`^[A-Za-z_][A-Za-z_0-9]*(\.[A-Za-z_][A-Za-z_0-9]*)*$`)

// This scanner recognizes only macro boundaries, not the ScopeQL grammar.
func expandTimeFilter(query string, from, to time.Time) (string, error) {
	var out strings.Builder
	for i := 0; i < len(query); {
		start := i
		if query[i] == '\'' || query[i] == '"' || query[i] == 96 {
			quote := query[i]
			i++
			for i < len(query) {
				if query[i] == '\\' {
					i += min(2, len(query)-i)
					continue
				}
				if query[i] == quote {
					i++
					if i < len(query) && query[i] == quote {
						i++
						continue
					}
					break
				}
				i++
			}
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
			end := strings.Index(query[i+2:], "*/")
			if end == -1 {
				out.WriteString(query[i:])
				break
			}
			i += end + 4
			out.WriteString(query[start:i])
			continue
		}
		if strings.HasPrefix(query[i:], "$__") {
			const macro = "$__timeFilter("
			if !strings.HasPrefix(query[i:], macro) {
				return "", fmt.Errorf("unsupported macro; use $__timeFilter(column)")
			}
			end := strings.IndexByte(query[i+len(macro):], ')')
			if end == -1 {
				return "", fmt.Errorf("unclosed $__timeFilter(column)")
			}
			arg := strings.TrimSpace(query[i+len(macro) : i+len(macro)+end])
			if !columnReference.MatchString(arg) {
				return "", fmt.Errorf("$__timeFilter requires an unquoted column reference")
			}
			if !from.Before(to) {
				return "", fmt.Errorf("time range must have from < to")
			}
			fmt.Fprintf(&out, "(%s >= '%s'::timestamp AND %s < '%s'::timestamp)", arg, from.UTC().Format(time.RFC3339Nano), arg, to.UTC().Format(time.RFC3339Nano))
			i += len(macro) + end + 1
			continue
		}
		out.WriteByte(query[i])
		i++
	}
	return out.String(), nil
}
