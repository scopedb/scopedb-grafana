import { test, expect } from '@grafana/plugin-e2e';

test.use({ viewport: { width: 1680, height: 1100 } });

test('portable editor executes a scalar query', async ({ panelEditPage, readProvisionedDataSource, page }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('Table');
  const row = panelEditPage.getQueryEditorRow('A');
  const editor = row.getByRole('textbox', { name: /^ScopeQL(?:;|$)/ });
  await editor.click();
  await editor.press('Control+A');
  await page.keyboard.insertText("SELECT 'any workspace' AS source, 42 AS answer");
  const response = panelEditPage.waitForQueryDataResponse((r) =>
    r
      .request()
      .postDataJSON()
      .queries.some((q: { queryText?: string }) => q.queryText?.includes('any workspace'))
  );
  await row.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(response).toBeOK();
  await expect(panelEditPage.panel.data).toContainText(['any workspace', '42']);
});

test('editing preserves time series format and returns labelled values', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  const row = panelEditPage.getQueryEditorRow('A');
  await row.getByRole('combobox', { name: 'Format', exact: true }).click();
  await page.getByRole('option', { name: 'Time series', exact: true }).click();
  const editor = row.getByRole('textbox', { name: /^ScopeQL(?:;|$)/ });
  await editor.click();
  await editor.press('Control+A');
  await page.keyboard.insertText("SELECT $__timeFrom() AS time, 'api' AS service, 42 AS requests");
  const pending = panelEditPage.waitForQueryDataResponse((r) =>
    r
      .request()
      .postDataJSON()
      .queries.some((q: { queryText?: string }) => q.queryText?.includes('AS requests'))
  );
  await editor.press('Control+Enter');
  await expect(pending).toBeOK();
  const response = await pending;
  expect(response.request().postDataJSON().queries[0].format).toBe('time_series');
  const result = (await response.json()).results.A;
  expect(result.frames[0].schema.meta.type).toBe('timeseries-multi');
  expect(result.frames[0].schema.fields[1].labels).toEqual({ service: 'api' });
  expect(result.frames[0].data.values[1]).toEqual([42]);
  await expect(panelEditPage.panel.getErrorIcon()).not.toBeVisible();
});

test('catalog generates a query for a discovered table', async ({
  panelEditPage,
  readProvisionedDataSource,
  page,
}, testInfo) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('Table');
  const row = panelEditPage.getQueryEditorRow('A');
  const tablesResponse = page.waitForResponse((r) => r.url().includes('/resources/tables?') && r.status() === 200);
  await row.getByRole('button', { name: 'Browse tables' }).click();
  const catalog = await (await tablesResponse).json();
  test.skip(catalog.items.length === 0, 'Workspace has no tables to browse');
  const table = catalog.items[0].name;
  await row.getByRole('combobox', { name: 'Table', exact: true }).click();
  await page.getByRole('option', { name: table, exact: true }).click();
  await expect(row.getByRole('button', { name: 'Insert table query' })).toBeEnabled();
  await row.getByRole('button', { name: 'Insert table query' }).click();
  const response = panelEditPage.waitForQueryDataResponse((r) =>
    r
      .request()
      .postDataJSON()
      .queries.some((q: { queryText?: string }) => q.queryText?.includes('FROM') && q.queryText.includes(table))
  );
  await row.getByRole('button', { name: 'Run query', exact: true }).click();
  await expect(response).toBeOK();
  await expect(panelEditPage.panel.getErrorIcon()).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('generic-query-editor.png'), fullPage: true });
});

test('query variables support All, single selection and numeric formatting', async ({
  gotoDashboardPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const uid = `scopedb-variables-${Date.now()}`;
  const reference = { uid: ds.uid, type: ds.type };
  const saved = await page.request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        uid,
        title: uid,
        schemaVersion: 41,
        timezone: 'utc',
        time: { from: 'now-1h', to: 'now' },
        templating: {
          list: [
            {
              name: 'language',
              label: 'Language',
              type: 'query',
              datasource: reference,
              query:
                "SELECT 'English' AS __text, 'en' AS __value UNION ALL SELECT 'Japanese' AS __text, 'ja' AS __value",
              refresh: 1,
              multi: true,
              includeAll: true,
              current: { text: ['All'], value: ['$__all'] },
              options: [],
            },
            { name: 'threshold', type: 'constant', query: '12', current: { text: '12', value: '12' } },
          ],
        },
        panels: [
          {
            id: 1,
            title: 'Variable results',
            type: 'table',
            gridPos: { x: 0, y: 0, w: 24, h: 8 },
            datasource: reference,
            targets: [
              {
                refId: 'A',
                datasource: reference,
                modelVersion: 2,
                format: 'table',
                queryText:
                  "SELECT contains([${language}], 'en'::any) AS english, contains([${language}], 'ja'::any) AS japanese, ${threshold:number} AS threshold",
              },
            ],
            options: { showHeader: true },
          },
        ],
      },
      overwrite: false,
    },
  });
  expect(saved.ok()).toBeTruthy();
  try {
    let dashboard = await gotoDashboardPage({ uid });
    let panel = dashboard.getPanelByTitle('Variable results');
    await expect(panel.data).toContainText(['true', 'true', '12']);
    dashboard = await gotoDashboardPage({ uid, queryParams: new URLSearchParams({ 'var-language': 'ja' }) });
    panel = dashboard.getPanelByTitle('Variable results');
    await expect(panel.data).toContainText(['false', 'true', '12']);
    await expect(panel.getErrorIcon()).not.toBeVisible();
  } finally {
    await page.request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('getting started dashboard works without application tables', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
}) => {
  const config = await readProvisionedDashboard({ fileName: 'getting-started.json' });
  const dashboard = await gotoDashboardPage({ uid: config.uid });
  await dashboard.waitForPanelsQueriesToComplete();
  await expect(dashboard.getPanelByTitle('Connection check').locator).toContainText('1');
  await expect(dashboard.getPanelByTitle('Selected time range · UTC').data.first()).toBeVisible();
  await expect(dashboard.getPanelByTitle('Selected time range · UTC').getErrorIcon()).not.toBeVisible();
});
