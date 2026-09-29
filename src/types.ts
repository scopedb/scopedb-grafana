import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type QueryFormat = 'table' | 'time_series';
export interface ScopeDBQuery extends DataQuery {
  modelVersion?: number;
  queryText?: string;
  format?: QueryFormat;
}
export const DEFAULT_QUERY: Partial<ScopeDBQuery> = { modelVersion: 2, queryText: 'SELECT 1 AS ok', format: 'table' };
export interface ScopeDBOptions extends DataSourceJsonData {
  endpoint?: string;
  timeoutSeconds?: number;
  maxConcurrentQueries?: number;
}
export interface ScopeDBSecureOptions {
  apiKey?: string;
}
