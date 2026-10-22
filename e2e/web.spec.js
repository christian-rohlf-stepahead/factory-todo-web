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

test('AC6: adding a todo with a due date through the deployed web app shows it with that due date', async ({ page }) => {
  await page.goto('/');

  const title = `File the expense report (${Date.now()})`;
  const due = '2026-12-15';
  await page.locator('#title-input').fill(title);
  await page.locator('#due-input').fill(due);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();
  await expect(item).toContainText(due);
});

test("AC7: changing an existing todo's due date through the deployed web app shows the new date", async ({ page }) => {
  await page.goto('/');

  const title = `Confirm the venue booking (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();

  const newDue = '2027-01-20';
  const dueField = item.locator('input.due-edit');
  await dueField.fill(newDue);
  await dueField.blur();

  await expect(item).toContainText(newDue);
});

test('AC8: the seeded overdue todo is visibly marked overdue in the deployed web app and the others are not', async ({ page }) => {
  await page.goto('/');

  const overdueItem = page.locator('#todo-list li', { hasText: 'Renew the parking permit' });
  const doneItem = page.locator('#todo-list li', { hasText: 'Water the office plants' });
  const futureItem = page.locator('#todo-list li', { hasText: 'Plan the team offsite' });

  await expect(overdueItem).toHaveClass(/overdue/);
  await expect(doneItem).not.toHaveClass(/overdue/);
  await expect(futureItem).not.toHaveClass(/overdue/);
});
