import {
  CoreApp,
  DataQueryRequest,
  LegacyMetricFindQueryOptions,
  MetricFindValue,
  ScopedVars,
  dateTime,
  toDataFrame,
} from '@grafana/data';
import { DataSourceWithBackend, getTemplateSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { CatalogColumn, CatalogItem, CatalogPage, ScopeDBOptions, ScopeDBQuery, DEFAULT_QUERY } from './types';
import { interpolateVariables } from './variables';

export class DataSource extends DataSourceWithBackend<ScopeDBQuery, ScopeDBOptions> {
  getDefaultQuery(_: CoreApp): Partial<ScopeDBQuery> {
    return DEFAULT_QUERY;
  }
  filterQuery(query: ScopeDBQuery): boolean {
    return !query.hide && Boolean(query.queryText?.trim());
  }
  applyTemplateVariables(query: ScopeDBQuery, scopedVars: ScopedVars): ScopeDBQuery {
    return { ...query, queryText: interpolateVariables(query.queryText ?? '', scopedVars, getTemplateSrv()) };
  }

  async metricFindQuery(query: string, options?: LegacyMetricFindQueryOptions): Promise<MetricFindValue[]> {
    const to = dateTime();
    const range = options?.range ?? { from: dateTime(to.valueOf() - 3600000), to, raw: { from: 'now-1h', to: 'now' } };
    const request: DataQueryRequest<ScopeDBQuery> = {
      app: CoreApp.Dashboard,
      requestId: `scopedb-variable-${options?.variable?.name ?? 'preview'}`,
      interval: '1m',
      intervalMs: 60000,
      maxDataPoints: 1000,
      range,
      scopedVars: options?.scopedVars ?? {},
      timezone: 'utc',
      startTime: Date.now(),
      targets: [{ refId: 'variable', queryText: query, modelVersion: 2, format: 'table' }],
    };
    const result = await lastValueFrom(this.query(request));
    if (result.errors?.length) {
      throw new Error(result.errors[0].message);
    }
    const values = new Map<string, MetricFindValue>();
    for (const entry of result.data) {
      const frame = toDataFrame(entry);
      const text = frame.fields.find((f) => f.name === '__text') ?? frame.fields[0];
      const value = frame.fields.find((f) => f.name === '__value') ?? text;
      if (!text || !value) {
        continue;
      }
      for (let i = 0; i < frame.length; i++) {
        if (text.values[i] == null || value.values[i] == null) {
          continue;
        }
        const raw = value.values[i];
        const item = { text: String(text.values[i]), value: typeof raw === 'number' ? raw : String(raw) };
        values.set(String(item.value), item);
      }
    }
    return [...values.values()];
  }

  async catalog(path: 'databases' | 'schemas' | 'tables', params: Record<string, string> = {}): Promise<CatalogItem[]> {
    const items: CatalogItem[] = [];
    const seen = new Set<string>();
    let pageToken = '';
    do {
      const page = await this.getResource<CatalogPage>(path, { ...params, pageToken });
      items.push(...page.items);
      pageToken = page.next_page_token ?? '';
      if (pageToken && (seen.has(pageToken) || items.length >= 10000)) {
        throw new Error('Catalog has too many entries or repeated pages; use a fully qualified table name in ScopeQL');
      }
      seen.add(pageToken);
    } while (pageToken);
    return items;
  }
  async columns(database: string, schema: string, table: string): Promise<CatalogColumn[]> {
    return (await this.getResource<{ columns: CatalogColumn[] }>('columns', { database, schema, table })).columns;
  }
}
