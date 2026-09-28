package plugin

import (
	"fmt"
	"math"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	scopedb "github.com/scopedb/goscopedb"
)

func toFrame(refID string, rs *scopedb.ResultSet) (*data.Frame, error) {
	if rs == nil {
		return nil, fmt.Errorf("ScopeDB returned no result set")
	}
	if rs.TotalRows > 10000 {
		return nil, fmt.Errorf("Result exceeds 10,000 rows; add a LIMIT clause")
	}
	rows, err := rs.RawRows()
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if len(row) != len(rs.Schema) {
			return nil, fmt.Errorf("result column count does not match schema")
		}
	}
	frame := data.NewFrame("ScopeDB")
	frame.RefID = refID
	frame.Meta = &data.FrameMeta{PreferredVisualization: "table"}
	for col, schema := range rs.Schema {
		raw := make([]*string, len(rows))
		for row := range rows {
			raw[row] = rows[row][col]
		}
		var values any = raw
		switch schema.Type {
		case scopedb.IntDataType, scopedb.UIntDataType, scopedb.FloatDataType:
			numbers := make([]*float64, len(raw))
			exact := true
			for i, cell := range raw {
				if cell == nil {
					continue
				}
				var n float64
				var parseErr error
				switch schema.Type {
				case scopedb.IntDataType:
					var v int64
					v, parseErr = strconv.ParseInt(*cell, 10, 64)
					n = float64(v)
					if v > 9007199254740991 || v < -9007199254740991 {
						exact = false
					}
				case scopedb.UIntDataType:
					var v uint64
					v, parseErr = strconv.ParseUint(*cell, 10, 64)
					n = float64(v)
					if v > 9007199254740991 {
						exact = false
					}
				default:
					n, parseErr = strconv.ParseFloat(*cell, 64)
				}
				if parseErr != nil {
					return nil, fmt.Errorf("invalid %s in column %s", schema.Type, schema.Name)
				}
				if math.IsInf(n, 0) || math.IsNaN(n) {
					exact = false
				}
				numbers[i] = &n
			}
			if exact {
				values = numbers
			}
		case scopedb.BooleanDataType:
			booleans := make([]*bool, len(raw))
			for i, cell := range raw {
				if cell != nil {
					v, err := strconv.ParseBool(*cell)
					if err != nil {
						return nil, fmt.Errorf("invalid boolean in column %s", schema.Name)
					}
					booleans[i] = &v
				}
			}
			values = booleans
		case scopedb.TimestampDataType:
			times := make([]*time.Time, len(raw))
			for i, cell := range raw {
				if cell != nil {
					v, err := time.Parse(time.RFC3339Nano, *cell)
					if err != nil {
						return nil, fmt.Errorf("invalid timestamp in column %s", schema.Name)
					}
					v = v.UTC()
					times[i] = &v
				}
			}
			values = times
		}
		// Complex types, binary, intervals, and unsafe integers preserve their wire text.
		frame.Fields = append(frame.Fields, data.NewField(schema.Name, nil, values))
	}
	return frame, nil
}
