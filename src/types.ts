import { DataSourceJsonData } from '@grafana/data';
import { DataQuery } from '@grafana/schema';

export type QueryFormat = 'table' | 'time_series';
export interface MyQuery extends DataQuery {
  modelVersion?: number;
  queryText?: string;
  format?: QueryFormat;
}
export const DEFAULT_QUERY: Partial<MyQuery> = { modelVersion: 2, queryText: 'SELECT 1 AS ok', format: 'table' };
export interface MyDataSourceOptions extends DataSourceJsonData {
  endpoint?: string;
  timeoutSeconds?: number;
  maxConcurrentQueries?: number;
}
export interface MySecureJsonData {
  apiKey?: string;
}
export interface CatalogItem {
  name: string;
  comment?: string | null;
}
export interface CatalogColumn extends CatalogItem {
  data_type: string;
}
export interface CatalogPage {
  items: CatalogItem[];
  next_page_token?: string;
}
