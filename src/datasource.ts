import { CoreApp } from '@grafana/data';
import { DataSourceWithBackend } from '@grafana/runtime';
import { MyQuery, MyDataSourceOptions, DEFAULT_QUERY } from './types';
export class DataSource extends DataSourceWithBackend<MyQuery, MyDataSourceOptions> {
  getDefaultQuery(_: CoreApp): Partial<MyQuery> {
    return DEFAULT_QUERY;
  }
  filterQuery(query: MyQuery): boolean {
    return !query.hide && Boolean(query.queryText?.trim());
  }
}
