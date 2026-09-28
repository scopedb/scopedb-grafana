import React from 'react';
import { Field, TextArea } from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery } from '../types';
type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;
export function QueryEditor({ query, onChange, onRunQuery }: Props) {
  return (
    <div data-testid="scopedb-query-editor">
      <Field
        label="ScopeQL"
        description="Table results · Ctrl/Cmd+Enter to run · Use LIMIT to bound results (maximum 10,000 rows)."
      >
        <TextArea
          aria-label="ScopeQL"
          id={`scopedb-query-${query.refId}`}
          rows={7}
          value={query.queryText ?? ''}
          spellCheck={false}
          placeholder="SELECT 1 AS ok"
          onChange={(e) => onChange({ ...query, modelVersion: 1, queryText: e.currentTarget.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onRunQuery();
            }
          }}
        />
      </Field>
      <p>
        {'Time filter: $__timeFilter(event_time) expands to UTC [from, to). Dashboard variables are not supported.'}
      </p>
    </div>
  );
}
