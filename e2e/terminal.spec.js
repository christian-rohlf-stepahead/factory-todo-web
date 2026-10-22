import { test, expect } from '@playwright/test';

// Same three seed titles as web.spec.js — see todo-api's migrate.js.
const SEEDED_TITLES = ['Renew the parking permit', 'Water the office plants', 'Plan the team offsite'];

test("AC3: the deployed web terminal's list command shows the three seeded todos", async ({ page }) => {
  await page.goto(process.env.FACTORY_URL_TODO_CLI);

  await page.locator('#command').fill('list');
  await page.locator('#command-form button[type="submit"]').click();

  const output = page.locator('#output');
  for (const title of SEEDED_TITLES) {
    await expect(output).toContainText(title);
  }
});
