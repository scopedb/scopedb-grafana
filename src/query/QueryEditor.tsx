import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  Alert,
  Button,
  CodeEditor,
  CodeEditorSuggestionItem,
  CodeEditorSuggestionItemKind,
  InlineField,
  InlineFieldRow,
  Combobox,
  Stack,
} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { DataSource } from '../datasource';
import { ScopeDBOptions, ScopeDBQuery, QueryFormat } from '../types';
import { quoteScopeQL } from './variables';
import { keywords, registerLanguage } from './language';
import { buildQueryTemplate, tableIdentifier } from './templates';
import type { TableSelection } from '../catalog/types';
import { SchemaBrowser } from '../catalog/SchemaBrowser';

type Props = QueryEditorProps<DataSource, ScopeDBQuery, ScopeDBOptions>;

export function QueryEditor(props: Props) {
  // A table selected in one data source must never generate queries in another.
  return <QueryEditorContent key={props.datasource.uid} {...props} />;
}

function QueryEditorContent({ query, datasource, onChange, onRunQuery, data }: Props) {
  const [table, setTable] = useState<TableSelection>();
  const callbacks = useRef({ query, onChange, onRunQuery });
  useLayoutEffect(() => {
    callbacks.current = { query, onChange, onRunQuery };
  }, [query, onChange, onRunQuery]);
  const change = useCallback((patch: Partial<ScopeDBQuery>) => {
    const current = callbacks.current;
    current.onChange({ ...current.query, modelVersion: 2, ...patch });
  }, []);
  const suggestions = (): CodeEditorSuggestionItem[] => [
    ...keywords.map((label) => ({ label, kind: CodeEditorSuggestionItemKind.Constant })),
    ...['count()', 'sum()', 'avg()', 'min()', 'max()', 'approx_count_distinct()', 'contains()'].map((label) => ({
      label,
      kind: CodeEditorSuggestionItemKind.Method,
    })),
    ...[
      '$__timeFilter(time)',
      '$__timeGroup(time)',
      '$__timeFrom()',
      '$__timeTo()',
      '$__interval',
      '$__interval_ms',
    ].map((label) => ({ label, kind: CodeEditorSuggestionItemKind.Method })),
    ...(table ? [{ label: tableIdentifier(table), kind: CodeEditorSuggestionItemKind.Property }] : []),
    ...(table?.columns ?? []).map((c) => ({
      label: c.name,
      insertText: quoteScopeQL(c.name, '`'),
      detail: c.data_type,
      kind: CodeEditorSuggestionItemKind.Field,
    })),
    ...getTemplateSrv()
      .getVariables()
      .map((v) => ({ label: '${' + v.name + '}', kind: CodeEditorSuggestionItemKind.Property })),
  ];
  const runTemplate = (format: QueryFormat) => {
    if (!table || (format === 'time_series' && !table.timeColumn)) {
      return;
    }
    const queryText = buildQueryTemplate(table, format);
    // Grafana must receive the new query and format before it starts the request.
    flushSync(() => change({ format, queryText }));
    callbacks.current.onRunQuery();
  };
  return (
    <div data-testid="scopedb-query-editor">
      <Stack direction="column" gap={1}>
        <InlineFieldRow>
          <InlineField label="Format" htmlFor={`scopedb-format-${query.refId}`}>
            <Combobox
              id={`scopedb-format-${query.refId}`}
              width={22}
              options={[
                { label: 'Table', value: 'table' },
                { label: 'Time series', value: 'time_series' },
              ]}
              value={query.format ?? 'table'}
              onChange={(v) => change({ format: v.value as QueryFormat })}
            />
          </InlineField>
          <Button size="sm" disabled={!query.queryText?.trim()} onClick={onRunQuery}>
            Run query
          </Button>
        </InlineFieldRow>
        <SchemaBrowser
          key={datasource.uid}
          datasource={datasource}
          idPrefix={`scopedb-${query.refId}`}
          onSelect={setTable}
          onRunTemplate={runTemplate}
        />
        <CodeEditor
          value={query.queryText ?? ''}
          language="scopeql"
          height={240}
          showLineNumbers
          showMiniMap={false}
          wordWrap
          monacoOptions={{ ariaLabel: 'ScopeQL', tabSize: 2 }}
          onBeforeEditorMount={registerLanguage}
          onEditorDidMount={(editor, monaco) => {
            editor.onKeyDown((event) => {
              if (event.keyCode === monaco.KeyCode.Enter && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                event.stopPropagation();
                callbacks.current.onRunQuery();
              }
            });
          }}
          onChange={(queryText) => change({ queryText })}
          onSave={() => callbacks.current.onRunQuery()}
          getSuggestions={suggestions}
        />
        {data?.errors
          ?.filter((error) => !error.refId || error.refId === query.refId)
          .map((error, index) => (
            <Alert key={index} title="Query failed" severity="error">
              {error.message}
            </Alert>
          ))}
        <details>
          <summary>ScopeQL query help</summary>
          <p>
            {
              'Ctrl/Cmd+Enter runs the query. Use LIMIT to bound results (10,000 rows maximum). $__timeFilter(column) uses the selected UTC [from, to) range; $__timeGroup(column) picks an interval for the range and panel resolution.'
            }
          </p>
          <p>
            {
              'Variables are quoted automatically: language = ${language}; multi-select: contains([${language}], language::any). Leave Custom all value blank. Use ${limit:number} for numbers and ${table:identifier} for one identifier; do not add quotes around variables.'
            }
          </p>
          <p>
            Time series requires one timestamp column and numeric values. String/boolean columns become series labels.
            Aggregate duplicate timestamps per label set; missing values stay null.
          </p>
        </details>
      </Stack>
    </div>
  );
}
