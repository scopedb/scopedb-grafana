import type { QueryFormat } from '../types.ts';
import type { TableSelection } from '../catalog/types.ts';
import { quoteScopeQL } from './variables.ts';

export const tableIdentifier = ({ database, schema, table }: TableSelection) =>
  [database, schema, table].map((name) => quoteScopeQL(name, '`')).join('.');

export function buildQueryTemplate(table: TableSelection, format: QueryFormat): string {
  const identifier = tableIdentifier(table);
  const time = table.timeColumn ? quoteScopeQL(table.timeColumn, '`') : '';
  if (format === 'time_series') {
    if (!time) {
      throw new Error('Choose a timestamp column to create a time series query');
    }
    return `FROM ${identifier}\nWHERE $__timeFilter(${time})\nSELECT $__timeGroup(${time}) AS time\nGROUP BY time AGGREGATE count() AS events\nORDER BY time\nLIMIT 10000`;
  }
  return `FROM ${identifier}\n${time ? `WHERE $__timeFilter(${time})\n` : ''}SELECT *\n${time ? `ORDER BY ${time} DESC\n` : ''}LIMIT 1000`;
}
