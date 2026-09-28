import { defineConfig } from 'eslint/config';
import baseConfig from './.config/eslint.config.mjs';

export default defineConfig([
  ...baseConfig,
  {
    ignores: [
      '.local/**',
      '.cache/**',
      'dist/**',
      'artifacts/**',
      'test-results/**',
      'playwright-report/**',
      'playwright/**',
    ],
  },
]);
