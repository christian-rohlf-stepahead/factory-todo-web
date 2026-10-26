import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'e2e/**/*.spec.js',
  reporter: [['junit', { outputFile: '/out/junit.xml' }]],
  outputDir: '/out/visuals',
  use: {
    baseURL: process.env.FACTORY_URL_TODO_WEB,
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'off',
  },
});
