# ScopeQL queries

## Result formats

**Table** preserves column order and nullable types. Timestamps become Grafana time fields; safe numbers become numeric fields; booleans remain booleans. Complex values, intervals, binary, non-finite numbers and integers outside ±(2^53−1) stay strings. Native Stat / Bar / Pie panels can consume appropriate table results.

**Time series** requires exactly one timestamp column and at least one safe numeric column. String and boolean columns become labels. Each label combination becomes a separate frame with time sorted ascending, numeric NULLs preserved and no zero fill. Aggregate to one row per timestamp and label set. Duplicate field names, NULL timestamps or dimensions, complex columns and unsafe numbers are rejected. An empty result preserves the numeric/time schema. Limits: 10,000 total input rows and 500 label combinations.

## Macros

Macros execute in the backend and are not replaced inside strings, quoted identifiers or comments. Columns may be unquoted references such as `e.event_time` or backtick-quoted references such as `` `event time` ``. Arbitrary expressions are not accepted as column arguments.

| Macro | Expansion / behavior |
| --- | --- |
| `$__timeFilter(column)` | UTC `column >= from AND column < to` |
| `$__timeFrom()` / `$__timeTo()` | Selected bounds as ScopeQL timestamp literals |
| `$__timeGroup(column)` | UTC epoch-aligned bucket chosen for the range, Grafana interval and maxDataPoints |
| `$__timeGroup(column, '5m')` | Fixed bucket; accepts Go durations between 1ms and 8760h; use `24h` instead of `1d` |
| `$__interval_ms` | Automatic bucket width as integer milliseconds |
| `$__interval` | Automatic bucket width as a ScopeQL interval value |

Automatic intervals have a 1-second floor and respect the panel interval. They target at most 10,000 buckets for one series; multiple dimensions can still exceed the total row limit. Fixed intervals intentionally override this calculation. Boundary buckets may be partial. Negative/pre-1970 timestamps round down to the preceding bucket.

```sql
FROM `scopedb`.`public`.`events`
WHERE $__timeFilter(`event_time`)
SELECT $__timeGroup(`event_time`) AS time, service
GROUP BY time, service AGGREGATE count() AS events
ORDER BY time
LIMIT 10000
```

## Variables

The query editor interpolates `$name` and `${name}` only outside quoted strings/identifiers and comments. Grafana built-ins beginning with `__` are reserved for backend macros; unsupported macros fail explicitly. Positional ScopeQL references such as `$0` remain unchanged.

| Syntax | Result |
| --- | --- |
| `${service}` or `${service:string}` | Quoted string; arrays expand to comma-separated quoted strings |
| `${limit:number}` | Validated finite number; arrays expand to a comma-separated numeric list |
| `${table:identifier}` | Exactly one backtick-quoted identifier; dots remain part of this one identifier |

Examples:

```sql
-- Single selected service
FROM events WHERE service = ${service} SELECT * LIMIT ${limit:number}

-- Multi-select; ScopeQL uses contains(array, value), not SQL IN
FROM events
WHERE $__timeFilter(event_time)
AND contains([${service}], service::any)
SELECT event_time, service, message
ORDER BY event_time DESC
LIMIT 1000

-- A qualified path uses one variable per identifier component
FROM ${database:identifier}.${schema:identifier}.${table:identifier}
SELECT * LIMIT 100
```

Variable values are escaped using ScopeQL backslash escapes, including quotes, backslashes and control characters. Do not write `'${service}'`: variables inside strings remain literal text. Raw, CSV and arbitrary Grafana format modifiers are not supported. Numeric formatting validates syntax without converting integer text through JavaScript floating point.

Query variables return the first column, or `__text` / `__value` for labels and values. NULL options are skipped and repeated values deduplicated. The query uses the dashboard time range (a last-hour fallback is used if no range is supplied). Refresh on time-range change when the variable query uses time macros. Chained query variables can use prior variables.

For **Include All**, leave **Custom all value** blank. All expands the actual options into a safely quoted list; it is not an unrestricted wildcard. Only selected/fetched options are included, so keep variable query limits appropriate to the intended domain.

## Errors and diagnostics

Query inspector includes the expanded query, query ID, total elapsed time, input row count and chosen interval. Timeouts include queue time. Authentication and API status errors are classified separately from query syntax errors. Cancellation attempts use a separate short cleanup context; inability to confirm server cancellation remains visible. Query submission is not automatically retried.

These features follow Grafana's [variables](https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-support-for-variables), [resource handlers](https://grafana.com/developers/plugin-tools/how-to-guides/data-source-plugins/add-resource-handler), and [data frames](https://grafana.com/developers/plugin-tools/key-concepts/data-frames) interfaces. ScopeQL reference: [docs.scopedb.io/reference](https://docs.scopedb.io/reference).
