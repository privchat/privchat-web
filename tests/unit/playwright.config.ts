import { defineConfig } from '@playwright/test';

// Pure feature tests: no dev server, browser, or device is started.
export default defineConfig({ testDir: '.', workers: 1, reporter: 'list' });
