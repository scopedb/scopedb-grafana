import { test, expect } from '@grafana/plugin-e2e';
import overview from '../provisioning/dashboards/bluesky-overview.json';
import content from '../provisioning/dashboards/bluesky-content.json';

test.use({ viewport: { width: 1680, height: 1600 } });

for (const definition of [overview, content]) {
  test(`${definition.title}: real panels render`, async ({
    gotoDashboardPage,
    readProvisionedDashboard,
    page,
  }, testInfo) => {
    const provisioned = await readProvisionedDashboard({ fileName: `${definition.uid}.json` });
    const view = await gotoDashboardPage({ uid: provisioned.uid });
    await view.waitForPanelsQueriesToComplete({ scrollAll: true, timeout: 60_000 });
    for (const panelSpec of definition.panels.filter((p) => p.type !== 'text')) {
      const panel = view.getPanelByTitle(panelSpec.title);
      await panel.scrollIntoView();
      await expect(panel.getErrorIcon()).not.toBeVisible();
      await expect(panel.locator).not.toContainText('No data');
      if (panelSpec.type === 'table') {
        await expect(panel.data.first()).toBeVisible();
      }
      if (panelSpec.type === 'timeseries') {
        await expect(panel.locator.locator('canvas').first()).toBeVisible();
      }
    }
    await page.keyboard.press('Control+Home');
    await view.getPanelById('1').scrollIntoView();
    await page.screenshot({ path: testInfo.outputPath(`${definition.uid}.png`), fullPage: true });
    if (definition.uid === content.uid) {
      const posts = view.getPanelByTitle(content.panels[2].title);
      await posts.scrollIntoView();
      await expect(posts.data).toContainText(['did:plc:']);
      const postLink = posts.locator.getByRole('link', { name: 'Open post', exact: true }).first();
      await expect(postLink).toHaveAttribute('href', /^https:\/\/bsky\.app\/profile\/did:.*\/post\//);
      await expect(postLink).toHaveAttribute('target', '_blank');
      await posts.locator.screenshot({ path: testInfo.outputPath('bluesky-posts.png') });
    }
  });
}
