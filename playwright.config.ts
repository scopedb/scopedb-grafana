import type { PluginOptions } from '@grafana/plugin-e2e';
import { defineConfig } from '@playwright/test';
import baseConfig from './.config/playwright.config';

export default defineConfig<PluginOptions>(baseConfig, {
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.GRAFANA_URL || 'http://127.0.0.1:13000',
    provisioningRootDir: './provisioning',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
});
