import { test, expect } from '@playwright/test';

// The three example todos every fresh deployment seeds, per todo-api's
// migration (src/migrate.js): one overdue high-priority, one completed
// low-priority, one plain open todo with a future due date.
const SEEDED_TITLES = ['Renew the parking permit', 'Water the office plants', 'Plan the team offsite'];

test('AC1: the deployed web app shows the three seeded todos', async ({ page }) => {
  await page.goto('/');

  const items = page.locator('#todo-list li');
  await expect(items).toHaveCount(3);

  const text = await items.allTextContents();
  for (const title of SEEDED_TITLES) {
    expect(text.some((line) => line.includes(title))).toBe(true);
  }
});

test('AC2: a todo added through the deployed web app appears in its list', async ({ page }) => {
  await page.goto('/');

  const title = `Pack the conference badges (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  await expect(page.locator('#todo-list li', { hasText: title })).toBeVisible();
});
