import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, Combobox, InlineField, InlineFieldRow } from '@grafana/ui';
import { DataSource } from '../datasource';
import { CatalogColumn, CatalogItem } from '../types';
import { quoteScopeQL } from '../variables';

export interface TableSelection {
  identifier: string;
  columns: CatalogColumn[];
  timeColumn?: string;
}
interface Props {
  datasource: DataSource;
  idPrefix: string;
  onSelect: (table: TableSelection | undefined) => void;
}
interface CatalogState {
  databases: CatalogItem[];
  schemas: CatalogItem[];
  tables: CatalogItem[];
  columns: CatalogColumn[];
  database: string;
  schema: string;
  table: string;
  timeColumn: string;
}
const empty: CatalogState = {
  databases: [],
  schemas: [],
  tables: [],
  columns: [],
  database: '',
  schema: '',
  table: '',
  timeColumn: '',
};
const options = (items: CatalogItem[]) =>
  items.map((item) => ({ label: item.name, value: item.name, description: item.comment ?? undefined }));
function errorMessage(error: unknown): string {
  const value = error as { message?: string; data?: { message?: string } };
  return value?.data?.message ?? value?.message ?? 'Could not load catalog';
}

export function SchemaBrowser({ datasource, idPrefix, onSelect }: Props) {
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<CatalogState>(empty);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [datasource]
  );
  const select = (next: CatalogState) => {
    setState(next);
    onSelect(
      next.table && next.columns.length
        ? {
            identifier: [next.database, next.schema, next.table].map((v) => quoteScopeQL(v, '`')).join('.'),
            columns: next.columns,
            timeColumn: next.timeColumn ? quoteScopeQL(next.timeColumn, '`') : undefined,
          }
        : undefined
    );
  };
  const load = async (level: 'root' | 'database' | 'schema' | 'table', name = '') => {
    const token = ++revision.current;
    let next: CatalogState = { ...state, columns: [], timeColumn: '' };
    if (level !== 'table') {
      next.table = '';
      next.tables = [];
    }
    if (level === 'root' || level === 'database') {
      next.schema = '';
      next.schemas = [];
    }
    if (level === 'root') {
      next = { ...empty };
    }
    if (level === 'database') {
      next.database = name;
    }
    if (level === 'schema') {
      next.schema = name;
    }
    if (level === 'table') {
      next.table = name;
    }
    select({ ...next });
    setError('');
    setLoading(true);
    try {
      if (level === 'root') {
        next.databases = await datasource.catalog('databases');
        next.database = (next.databases.find((d) => d.name === 'scopedb') ?? next.databases[0])?.name ?? '';
      }
      if ((level === 'root' || level === 'database') && next.database) {
        next.schemas = await datasource.catalog('schemas', { database: next.database });
        next.schema = (next.schemas.find((s) => s.name === 'public') ?? next.schemas[0])?.name ?? '';
      }
      if (level !== 'table' && next.database && next.schema) {
        next.tables = await datasource.catalog('tables', { database: next.database, schema: next.schema });
      }
      if (level === 'table' && next.table) {
        next.columns = await datasource.columns(next.database, next.schema, next.table);
        next.timeColumn = next.columns.find((c) => c.data_type === 'timestamp')?.name ?? '';
      }
      if (revision.current === token) {
        select(next);
      }
    } catch (e) {
      if (revision.current === token) {
        setError(errorMessage(e));
      }
    } finally {
      if (revision.current === token) {
        setLoading(false);
      }
    }
  };
  return (
    <div data-testid="scopedb-catalog">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          setOpened(!opened);
          if (!opened && !state.databases.length) {
            void load('root');
          }
        }}
      >
        {opened ? 'Hide catalog' : 'Browse tables'}
      </Button>
      {opened && (
        <>
          <InlineFieldRow>
            <InlineField label="Database">
              <Combobox
                id={`${idPrefix}-database`}
                width={24}
                options={options(state.databases)}
                value={state.database}
                disabled={loading}
                onChange={(v) => void load('database', v.value)}
              />
            </InlineField>
            <InlineField label="Schema">
              <Combobox
                id={`${idPrefix}-schema`}
                width={24}
                options={options(state.schemas)}
                value={state.schema}
                disabled={loading}
                onChange={(v) => void load('schema', v.value)}
              />
            </InlineField>
            <InlineField label="Table">
              <Combobox
                id={`${idPrefix}-table`}
                width={36}
                options={options(state.tables)}
                value={state.table}
                disabled={loading}
                onChange={(v) => void load('table', v.value)}
              />
            </InlineField>
            <Button size="sm" variant="secondary" disabled={loading} onClick={() => void load('root')}>
              {loading ? 'Loading…' : 'Reload catalog'}
            </Button>
          </InlineFieldRow>
          {error && (
            <Alert title="Catalog unavailable" severity="warning">
              {error}. You can still enter ScopeQL directly.
            </Alert>
          )}
          {!loading && !error && state.tables.length === 0 && (
            <p>No tables found. Choose another database or schema, or add data to your workspace.</p>
          )}
          {state.columns.length > 0 && (
            <>
              <InlineField label="Time column">
                <Combobox
                  id={`${idPrefix}-time-column`}
                  width={32}
                  options={options(state.columns.filter((c) => c.data_type === 'timestamp'))}
                  value={state.timeColumn}
                  onChange={(v) => select({ ...state, timeColumn: v?.value ?? '' })}
                  isClearable
                />
              </InlineField>
              <p>{state.columns.map((c) => `${c.name}: ${c.data_type}`).join(' · ')}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
