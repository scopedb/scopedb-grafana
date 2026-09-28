import { test, expect } from '@grafana/plugin-e2e';
import dashboard from '../provisioning/dashboards/scopedb.json';

test('Table renders real ScopeDB values from the editor', async ({ panelEditPage, readProvisionedDataSource }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  await panelEditPage.setVisualization('Table');
  const sql = dashboard.panels[0].targets[0].queryText.replace('WHERE $__timeFilter(event_time)', '');
  const editor = panelEditPage.getQueryEditorRow('A').getByRole('textbox', { name: 'ScopeQL', exact: true });
  await editor.fill(sql);
  const response = panelEditPage.waitForQueryDataResponse((r) =>
    r
      .request()
      .postDataJSON()
      .queries.some((q: { queryText?: string }) => q.queryText === sql)
  );
  await editor.press('Control+Enter');
  await expect(response).toBeOK();
  await expect(panelEditPage.panel.data).toContainText(['api', 'lower boundary', 'worker', 'upper boundary']);
  await expect(panelEditPage.panel.data.nth(7)).toHaveText('');
});

test('ScopeQL syntax errors are visible', async ({ panelEditPage, readProvisionedDataSource }) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  await panelEditPage.datasource.set(ds.name);
  const editor = panelEditPage.getQueryEditorRow('A').getByRole('textbox', { name: 'ScopeQL', exact: true });
  await editor.fill('SELECT (');
  const response = panelEditPage.waitForQueryDataResponse((r) =>
    r
      .request()
      .postDataJSON()
      .queries.some((q: { queryText?: string }) => q.queryText === 'SELECT (')
  );
  await editor.press('Control+Enter');
  await expect(response).not.toBeOK();
  await expect(panelEditPage.panel.getErrorIcon()).toBeVisible();
});
