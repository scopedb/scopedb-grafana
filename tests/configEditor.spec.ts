import { test, expect } from '@grafana/plugin-e2e';

test('configured key stays hidden and Save & Test succeeds', async ({
  gotoDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const config = await gotoDataSourceConfigPage(ds.uid);
  const editor = page.getByTestId('scopedb-config');
  await expect(editor.getByRole('textbox', { name: 'Endpoint', exact: true })).toHaveValue(/^https?:/);
  await expect(config.saveAndTest()).toBeOK();
  await expect(config).toHaveAlert('success', { hasText: 'ScopeDB connected' });
});

test('missing key produces an actionable error', async ({
  createDataSourceConfigPage,
  readProvisionedDataSource,
  page,
}) => {
  const ds = await readProvisionedDataSource({ fileName: 'datasources.yml' });
  const config = await createDataSourceConfigPage({ type: ds.type });
  await page
    .getByTestId('scopedb-config')
    .getByRole('textbox', { name: 'Endpoint', exact: true })
    .fill('https://example.invalid');
  await expect(config.saveAndTest()).not.toBeOK();
  await expect(config).toHaveAlert('error', { hasText: 'API key is missing' });
});
