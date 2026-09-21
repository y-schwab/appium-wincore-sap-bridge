// @ts-check

import { defineConfig } from 'eslint/config';
import appiumConfig from '@appium/eslint-config-appium-ts';

export default defineConfig(
  ...appiumConfig,
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    rules: {
      'no-console': 'off',
    },
  },
);
