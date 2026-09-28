import { test, expect } from '@grafana/plugin-e2e';
test.use({ provisioningRootDir: './examples/provisioning' });
import fixture from '../examples/provisioning/dashboards/scopedb.json';

test('provisioned dashboard displays real rows and follows the time picker', async ({
  gotoDashboardPage,
  readProvisionedDashboard,
  components,
  page,
}, testInfo) => {
  page.on('pageerror', (error) => console.error(error.message));
  const dashboard = await readProvisionedDashboard({ fileName: 'scopedb.json' });
  const view = await gotoDashboardPage({ uid: dashboard.uid });
  const panel = view.getPanelByTitle(fixture.panels[0].title);
  await expect(panel.data).toContainText(['api', 'lower boundary', 'worker']);
  await expect(panel.data).not.toContainText(['upper boundary']);
  await page.screenshot({ path: testInfo.outputPath('dashboard.png'), fullPage: true });
  await components.timeRangePicker.set({ from: '2026-09-28 00:10:00', to: '2026-09-28 00:21:00' });
  await expect(panel.data).toContainText(['worker', 'api', 'upper boundary']);
  await expect(panel.data).not.toContainText(['lower boundary']);
});
