import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';
export interface MyQuery extends DataQuery {
  modelVersion?: number;
  queryText?: string;
}
export const DEFAULT_QUERY: Partial<MyQuery> = { modelVersion: 1, queryText: 'SELECT 1 AS ok' };
export interface MyDataSourceOptions extends DataSourceJsonData {
  endpoint?: string;
  timeoutSeconds?: number;
}
export interface MySecureJsonData {
  apiKey?: string;
}
