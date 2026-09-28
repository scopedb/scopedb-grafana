package plugin

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	scopedb "github.com/scopedb/goscopedb"
)

func validateSeriesTypes(schema scopedb.Schema, frame *data.Frame) error {
	for i, column := range schema {
		switch column.Type {
		case scopedb.IntDataType, scopedb.UIntDataType, scopedb.FloatDataType:
			if frame.Fields[i].Type() != data.FieldTypeNullableFloat64 {
				return fmt.Errorf("Time series column %q contains non-finite or unsafe numeric values; use Table to preserve them", column.Name)
			}
		case scopedb.TimestampDataType, scopedb.StringDataType, scopedb.BooleanDataType:
		default:
			return fmt.Errorf("Time series cannot use %s column %q; select timestamp, numeric and label columns only", column.Type, column.Name)
		}
	}
	return nil
}

// Separate frames for dimension combinations avoid sparse wide-frame expansion.
func timeSeriesFrames(input *data.Frame) (data.Frames, error) {
	timeIndex := -1
	values, dimensions := []int{}, []int{}
	names := map[string]bool{}
	for i, f := range input.Fields {
		if names[f.Name] {
			return nil, fmt.Errorf("duplicate column %q; give each result column a unique alias", f.Name)
		}
		names[f.Name] = true
		switch f.Type() {
		case data.FieldTypeNullableTime:
			if timeIndex >= 0 {
				return nil, fmt.Errorf("Time series requires exactly one timestamp column")
			}
			timeIndex = i
		case data.FieldTypeNullableFloat64:
			values = append(values, i)
		case data.FieldTypeNullableString, data.FieldTypeNullableBool:
			dimensions = append(dimensions, i)
		default:
			return nil, fmt.Errorf("unsupported Time series column %q", f.Name)
		}
	}
	if timeIndex < 0 || len(values) == 0 {
		return nil, fmt.Errorf("Time series requires one timestamp column and at least one numeric column; use Table for other results")
	}
	rows := make([]int, input.Rows())
	for i := range rows {
		rows[i] = i
		if input.Fields[timeIndex].NilAt(i) {
			return nil, fmt.Errorf("Time series timestamp cannot be NULL")
		}
	}
	timeAt := func(i int) time.Time { return *input.Fields[timeIndex].At(i).(*time.Time) }
	sort.SliceStable(rows, func(i, j int) bool { return timeAt(rows[i]).Before(timeAt(rows[j])) })
	frames := data.Frames{}
	groups := map[string]*data.Frame{}
	newFrame := func(labels data.Labels) *data.Frame {
		frame := data.NewFrame(input.Name, data.NewField(input.Fields[timeIndex].Name, nil, []time.Time{}))
		frame.RefID = input.RefID
		frame.Meta = &data.FrameMeta{Type: data.FrameTypeTimeSeriesMulti, TypeVersion: data.FrameTypeVersion{0, 1}, PreferredVisualization: "graph"}
		for _, col := range values {
			frame.Fields = append(frame.Fields, data.NewField(input.Fields[col].Name, labels, []*float64{}))
		}
		return frame
	}
	for _, row := range rows {
		labels := data.Labels{}
		for _, col := range dimensions {
			field := input.Fields[col]
			if field.NilAt(row) {
				return nil, fmt.Errorf("Time series dimension %q cannot be NULL; replace it in the query or use Table", field.Name)
			}
			if field.Type() == data.FieldTypeNullableBool {
				labels[field.Name] = strconv.FormatBool(*field.At(row).(*bool))
			} else {
				labels[field.Name] = *field.At(row).(*string)
			}
		}
		keyBytes, _ := json.Marshal(labels)
		key := string(keyBytes)
		frame := groups[key]
		if frame == nil {
			if len(groups) >= 500 {
				return nil, fmt.Errorf("Time series exceeds 500 series groups; aggregate or filter dimensions")
			}
			frame = newFrame(labels)
			groups[key] = frame
			frames = append(frames, frame)
		}
		t := timeAt(row)
		if frame.Rows() > 0 && frame.Fields[0].At(frame.Rows()-1).(time.Time).Equal(t) {
			return nil, fmt.Errorf("duplicate timestamp within a series; aggregate by time and dimensions before selecting Time series")
		}
		frame.Fields[0].Append(t)
		for i, col := range values {
			frame.Fields[i+1].Append(input.Fields[col].At(row))
		}
	}
	if len(frames) == 0 {
		frames = append(frames, newFrame(nil))
	}
	return frames, nil
}
