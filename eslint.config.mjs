import { defineConfig } from 'eslint/config';
import grafanaConfig from '@grafana/eslint-config/flat.js';

export default defineConfig([
  ...grafanaConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parserOptions: { project: './tsconfig.json' } },
    rules: { 'react/prop-types': 'off', '@typescript-eslint/no-deprecated': 'warn' },
  },
]);
