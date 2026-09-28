import { DataSourcePlugin } from '@grafana/data';
import { DataSource } from './datasource';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { ScopeDBQuery, ScopeDBOptions } from './types';

export const plugin = new DataSourcePlugin<DataSource, ScopeDBQuery, ScopeDBOptions>(DataSource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor);
