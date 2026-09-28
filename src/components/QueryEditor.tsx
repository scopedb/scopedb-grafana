import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  CodeEditor,
  CodeEditorSuggestionItem,
  CodeEditorSuggestionItemKind,
  InlineField,
  InlineFieldRow,
  Combobox,
  Monaco,
} from '@grafana/ui';
import { QueryEditorProps } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';
import { DataSource } from '../datasource';
import { MyDataSourceOptions, MyQuery, QueryFormat } from '../types';
import { quoteScopeQL } from '../variables';
import { SchemaBrowser, TableSelection } from './SchemaBrowser';

type Props = QueryEditorProps<DataSource, MyQuery, MyDataSourceOptions>;
const keywords = [
  'FROM',
  'WHERE',
  'SELECT',
  'GROUP BY',
  'AGGREGATE',
  'ORDER BY',
  'LIMIT',
  'AS',
  'AND',
  'OR',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
];
function registerLanguage(monaco: Monaco) {
  if (monaco.languages.getLanguages().some((lang) => lang.id === 'scopeql')) {
    return;
  }
  monaco.languages.register({ id: 'scopeql' });
  monaco.languages.setMonarchTokensProvider('scopeql', {
    ignoreCase: true,
    keywords: keywords.flatMap((k) => k.split(' ')),
    tokenizer: {
      root: [
        [/--.*$/, 'comment'],
        [/\/\*/, 'comment', '@comment'],
        [/'(?:[^'\\]|\\.)*'/, 'string'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/`(?:[^`\\]|\\.)*`/, 'identifier'],
        [/\$\{[^}]+\}|\$[A-Za-z_][\w]*/, 'variable'],
        [/[a-zA-Z_][\w]*/, { cases: { '@keywords': 'keyword', '@default': 'identifier' } }],
        [/\d+(?:\.\d+)?/, 'number'],
      ],
      comment: [
        [/[^/*]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[/*]/, 'comment'],
      ],
    },
  });
}

export function QueryEditor({ query, datasource, onChange, onRunQuery, data }: Props) {
  const [table, setTable] = useState<TableSelection>();
  const callbacks = useRef({ query, onChange, onRunQuery });
  useEffect(() => {
    callbacks.current = { query, onChange, onRunQuery };
  }, [query, onChange, onRunQuery]);
  const change = useCallback((patch: Partial<MyQuery>) => {
    const current = callbacks.current;
    current.onChange({ ...current.query, modelVersion: 2, ...patch });
  }, []);
  const selectTable = useCallback((selection: TableSelection | undefined) => setTable(selection), []);
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
    ...(table ? [{ label: table.identifier, kind: CodeEditorSuggestionItemKind.Property }] : []),
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
  const insertTable = () => {
    if (!table) {
      return;
    }
    change({
      format: 'table',
      queryText: `FROM ${table.identifier}\n${table.timeColumn ? `WHERE $__timeFilter(${table.timeColumn})\n` : ''}SELECT *\n${table.timeColumn ? `ORDER BY ${table.timeColumn} DESC\n` : ''}LIMIT 1000`,
    });
  };
  const insertSeries = () => {
    if (!table?.timeColumn) {
      return;
    }
    change({
      format: 'time_series',
      queryText: `FROM ${table.identifier}\nWHERE $__timeFilter(${table.timeColumn})\nSELECT $__timeGroup(${table.timeColumn}) AS time\nGROUP BY time AGGREGATE count() AS events\nORDER BY time\nLIMIT 10000`,
    });
  };
  return (
    <div data-testid="scopedb-query-editor">
      <InlineFieldRow>
        <InlineField label="Format">
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
        <Button variant="secondary" size="sm" disabled={!table} onClick={insertTable}>
          Insert table query
        </Button>
        <Button variant="secondary" size="sm" disabled={!table?.timeColumn} onClick={insertSeries}>
          Insert time series query
        </Button>
        <Button size="sm" onClick={onRunQuery}>
          Run query
        </Button>
      </InlineFieldRow>
      <SchemaBrowser
        key={datasource.uid}
        datasource={datasource}
        idPrefix={`scopedb-${query.refId}`}
        onSelect={selectTable}
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
      {data?.errors?.[0] && (
        <Alert title="Query failed" severity="error">
          {data.errors[0].message}
        </Alert>
      )}
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
    </div>
  );
}
