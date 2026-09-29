import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Alert, Button, Combobox, InlineField, InlineFieldRow, Stack } from '@grafana/ui';
import type { DataSource } from '../datasource';
import type { QueryFormat } from '../types';
import type { CatalogItem, TableSelection } from './types';
import { CatalogController } from './controller';

interface Props {
  datasource: DataSource;
  idPrefix: string;
  onSelect: (table: TableSelection | undefined) => void;
  onRunTemplate: (format: QueryFormat) => void;
}
const options = (items: CatalogItem[]) =>
  items.map((item) => ({ label: item.name, value: item.name, description: item.comment ?? undefined }));

export function SchemaBrowser({ datasource, idPrefix, onSelect, onRunTemplate }: Props) {
  const [opened, setOpened] = useState(false);
  const catalog = useMemo(() => new CatalogController(datasource), [datasource]);
  const state = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  useEffect(() => catalog.cancel, [catalog]);
  useEffect(() => {
    onSelect(state.table && state.columns.length ? state : undefined);
  }, [state, onSelect]);
  const loading = Boolean(state.loading);
  const timestamps = state.columns.filter((column) => column.data_type === 'timestamp');
  const emptyMessage = !state.databases.length
    ? 'No databases found. Add data to your workspace, then reload the catalog.'
    : !state.schemas.length
      ? 'No schemas found in this database. Choose another database or add a schema.'
      : !state.tables.length
        ? 'No tables found in this schema. Choose another schema or add data to your workspace.'
        : state.table && !state.columns.length
          ? 'No columns found in this table. Reload the catalog or choose another table.'
          : '';

  return (
    <div data-testid="scopedb-catalog">
      <Stack direction="column" gap={1}>
        <div>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={opened}
            aria-controls={`${idPrefix}-catalog`}
            onClick={() => {
              setOpened(!opened);
              if (!opened && !state.loaded && !state.error && !loading) {
                void catalog.refresh();
              }
            }}
          >
            {opened ? 'Hide catalog' : 'Browse tables'}
          </Button>
        </div>
        {opened && (
          <div id={`${idPrefix}-catalog`} aria-busy={loading}>
            <InlineFieldRow>
              <InlineField
                disabled={loading || !state.databases.length}
                label="Database"
                htmlFor={`${idPrefix}-database`}
              >
                <Combobox
                  id={`${idPrefix}-database`}
                  width={24}
                  options={options(state.databases)}
                  value={state.database || null}
                  placeholder="Choose a database"
                  onChange={(value) => void catalog.selectDatabase(value.value)}
                />
              </InlineField>

              <InlineField disabled={loading || !state.schemas.length} label="Schema" htmlFor={`${idPrefix}-schema`}>
                <Combobox
                  id={`${idPrefix}-schema`}
                  width={24}
                  options={options(state.schemas)}
                  value={state.schema || null}
                  placeholder="Choose a schema"
                  onChange={(value) => void catalog.selectSchema(value.value)}
                />
              </InlineField>

              <InlineField disabled={loading || !state.tables.length} label="Table" htmlFor={`${idPrefix}-table`}>
                <Combobox
                  id={`${idPrefix}-table`}
                  width={36}
                  options={options(state.tables)}
                  value={state.table || null}
                  placeholder="Choose a table"
                  onChange={(value) => void catalog.selectTable(value.value)}
                />
              </InlineField>

              <Button size="sm" variant="secondary" disabled={loading} onClick={() => void catalog.refresh()}>
                Reload catalog
              </Button>
            </InlineFieldRow>
            {loading && <p role="status">Loading {state.loading}…</p>}
            {state.error && (
              <Alert title="Catalog unavailable" severity="warning">
                <p>{state.error}</p>
                <p>You can still enter ScopeQL directly.</p>
                <Button size="sm" variant="secondary" onClick={() => void catalog.retry()}>
                  Retry
                </Button>
              </Alert>
            )}
            {!loading && !state.error && state.loaded && emptyMessage && <p role="status">{emptyMessage}</p>}
            {!loading && !state.error && state.tables.length > 0 && !state.table && (
              <p>Choose a table to create a query, or enter ScopeQL below.</p>
            )}
            {state.columns.length > 0 && (
              <Stack direction="column" gap={1}>
                {timestamps.length > 0 ? (
                  <InlineField
                    label="Time column"
                    htmlFor={`${idPrefix}-time-column`}
                    tooltip="Used by generated queries to filter the selected Grafana time range. Clear it for an unfiltered table query."
                  >
                    <Combobox
                      id={`${idPrefix}-time-column`}
                      width={32}
                      options={options(timestamps)}
                      value={state.timeColumn || null}
                      placeholder="No time filter"
                      isClearable
                      onChange={(value) => catalog.selectTimeColumn(value?.value ?? '')}
                    />
                  </InlineField>
                ) : (
                  <p>This table has no timestamp column. Use a table query to explore its data.</p>
                )}
                {timestamps.length > 0 && !state.timeColumn && (
                  <p>
                    Choose a time column to enable time series. Table queries will not use the dashboard time range.
                  </p>
                )}
                <Stack gap={1} wrap="wrap">
                  <Button variant="secondary" size="sm" onClick={() => onRunTemplate('table')}>
                    Run table query
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!state.timeColumn}
                    onClick={() => onRunTemplate('time_series')}
                  >
                    Run time series query
                  </Button>
                </Stack>
                <div>Generated queries replace the editor contents and run immediately.</div>
                <details>
                  <summary>Columns ({state.columns.length})</summary>
                  <ul>
                    {state.columns.map((column) => (
                      <li key={column.name}>
                        <code>{column.name}</code> — {column.data_type}
                        {column.comment ? ` · ${column.comment}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              </Stack>
            )}
          </div>
        )}
      </Stack>
    </div>
  );
}
