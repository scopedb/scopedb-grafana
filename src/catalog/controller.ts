import type { CatalogColumn, CatalogItem, TableSelection } from './types.ts';

type Level = 'databases' | 'schemas' | 'tables' | 'columns';
export interface CatalogClient {
  catalog(path: Exclude<Level, 'columns'>, params?: Record<string, string>): Promise<CatalogItem[]>;
  columns(database: string, schema: string, table: string): Promise<CatalogColumn[]>;
}
export interface CatalogState extends TableSelection {
  databases: CatalogItem[];
  schemas: CatalogItem[];
  tables: CatalogItem[];
  loading?: Level;
  error?: string;
  loaded: boolean;
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
  loaded: false,
};
const choose = (items: CatalogItem[], preferred: string, fallback = '') =>
  (items.find((item) => item.name === preferred) ?? items.find((item) => item.name === fallback) ?? items[0])?.name ??
  '';

/** Owns catalog navigation, recovery, and stale-request protection independently of React. */
export class CatalogController {
  private state: CatalogState = { ...empty };
  private revision = 0;
  private listeners = new Set<() => void>();
  private failed?: { level: Level; preferred: CatalogState };

  private client: CatalogClient;

  constructor(client: CatalogClient) {
    this.client = client;
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  cancel = () => {
    this.revision++;
  };
  refresh = () => this.load('databases', this.failed?.preferred ?? this.state);
  retry = () => (this.failed ? this.load(this.failed.level, this.failed.preferred) : Promise.resolve());
  selectDatabase = (database: string) =>
    this.load('schemas', { ...this.state, database, schema: '', table: '', timeColumn: '' });
  selectSchema = (schema: string) => this.load('tables', { ...this.state, schema, table: '', timeColumn: '' });
  selectTable = (table: string) => this.load('columns', { ...this.state, table, timeColumn: '', columns: [] });
  selectTimeColumn = (timeColumn: string) => this.publish({ ...this.state, timeColumn });

  private publish(state: CatalogState) {
    this.state = state;
    this.listeners.forEach((listener) => listener());
  }

  private async load(start: Level, preferred: CatalogState) {
    const revision = ++this.revision;
    let level: Level | undefined = start;
    let next: CatalogState = { ...this.state, columns: [], timeColumn: '', error: undefined };
    if (start === 'databases') {
      next = { ...empty };
    } else if (start === 'schemas') {
      next = { ...next, database: preferred.database, schemas: [], schema: '', tables: [], table: '' };
    } else if (start === 'tables') {
      next = { ...next, schema: preferred.schema, tables: [], table: '' };
    } else {
      next.table = preferred.table;
    }
    this.failed = undefined;
    try {
      while (level) {
        this.publish({ ...next, loading: level });
        if (level === 'databases') {
          const databases = await this.client.catalog('databases');
          if (revision !== this.revision) {
            return;
          }
          next = { ...next, databases, database: choose(databases, preferred.database, 'scopedb') };
          level = next.database ? 'schemas' : undefined;
        } else if (level === 'schemas') {
          const schemas = await this.client.catalog('schemas', { database: next.database });
          if (revision !== this.revision) {
            return;
          }
          next = {
            ...next,
            schemas,
            schema: choose(schemas, next.database === preferred.database ? preferred.schema : '', 'public'),
          };
          level = next.schema ? 'tables' : undefined;
        } else if (level === 'tables') {
          const tables = await this.client.catalog('tables', { database: next.database, schema: next.schema });
          if (revision !== this.revision) {
            return;
          }
          const table =
            next.database === preferred.database && next.schema === preferred.schema
              ? (tables.find((item) => item.name === preferred.table)?.name ?? '')
              : '';
          next = { ...next, tables, table };
          level = table ? 'columns' : undefined;
        } else {
          const columns = await this.client.columns(next.database, next.schema, next.table);
          if (revision !== this.revision) {
            return;
          }
          const timestamps = columns.filter((column) => column.data_type === 'timestamp');
          const timeColumn =
            preferred.columns.length && preferred.timeColumn === ''
              ? ''
              : ((timestamps.find((column) => column.name === preferred.timeColumn) ?? timestamps[0])?.name ?? '');
          next = { ...next, columns, timeColumn };
          level = undefined;
        }
      }
      this.publish({ ...next, loading: undefined, loaded: true });
    } catch (error) {
      if (revision !== this.revision) {
        return;
      }
      this.failed = { level: level ?? start, preferred };
      const value = error as { message?: string; data?: { message?: string } };
      this.publish({
        ...next,
        loading: undefined,
        error: value?.data?.message ?? value?.message ?? 'Could not load catalog',
      });
    }
  }
}
