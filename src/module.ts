import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './configuration/ConfigEditor';
import { QueryEditor } from './query/QueryEditor';
import { ScopeDBQuery, ScopeDBOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, ScopeDBQuery, ScopeDBOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
