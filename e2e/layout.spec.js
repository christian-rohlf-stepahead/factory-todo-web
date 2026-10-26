import { test, expect } from '@playwright/test';

// Pins W2 of I-14 (a new layout for the todo page): the "needs attention,
// bottom composer" arrangement picked in the spec's Q2. AC1/AC2 — real
// layout and no horizontal overflow at a common desktop and phone width —
// can only be observed against an actual rendered page, so they live only
// here, the same split e2e/redesign.spec.js and test/redesign.test.js use
// for the prior redesign intent. AC3-AC10 are re-checked here against the
// deployed app on top of the jsdom coverage in test/layout.test.js, the same
// way e2e/redesign.spec.js and e2e/animations.spec.js re-check their own
// jsdom-pinned behaviour once actually rendered and deployed.
//
// The three todos every fresh deployment seeds (todo-api's src/migrate.js):
// one overdue, high-priority, tagged "errands" (needs attention); one
// completed, low-priority, untagged (not attention even though its due date
// has passed, since it's done); one open, normal-priority, due in the future
// (not attention).

const SEED_OVERDUE = 'Renew the parking permit';
const SEED_DONE = 'Water the office plants';
const SEED_FUTURE = 'Plan the team offsite';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 667 };

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('AC1: at a common desktop width, the new layout arranges the add form, sort, filter controls, and list with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto('/');

  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#filter-overdue')).toBeVisible();
  await expect(page.locator('#tag-filters')).toBeVisible();
  await expect(page.locator('#attention-section')).toBeVisible();
  await expect(page.locator('#rest-section')).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common desktop width').toBe(true);
});

test('AC2: at a common phone width, the new layout arranges the same elements with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('/');

  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#filter-overdue')).toBeVisible();
  await expect(page.locator('#tag-filters')).toBeVisible();
  await expect(page.locator('#attention-section')).toBeVisible();
  await expect(page.locator('#rest-section')).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common phone width').toBe(true);

  const title = `Mobile layout add check (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow after adding a todo at a common phone width').toBe(true);
});

test('AC6/AC7: the seeded overdue, high-priority todo is grouped into the needs-attention block, stays visibly distinguished, and priority/tags remain visible', async ({ page }) => {
  await page.goto('/');

  const attention = page.locator('#attention-section');
  const rest = page.locator('#rest-section');
  const overdueItem = attention.locator('li', { hasText: SEED_OVERDUE });
  await expect(overdueItem).toBeVisible();
  await expect(overdueItem).toHaveClass(/overdue/);
  await expect(overdueItem).toContainText('high');
  await expect(overdueItem).toContainText('errands');

  await expect(rest.locator('li', { hasText: SEED_DONE })).toBeVisible();
  await expect(rest.locator('li', { hasText: SEED_DONE })).not.toHaveClass(/overdue/);
  await expect(rest.locator('li', { hasText: SEED_FUTURE })).toBeVisible();
  await expect(rest.locator('li', { hasText: SEED_FUTURE })).not.toHaveClass(/overdue/);

  const [overdueStyle, futureStyle] = await Promise.all([
    overdueItem.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.color}|${s.backgroundColor}|${s.borderColor}`;
    }),
    rest.locator('li', { hasText: SEED_FUTURE }).evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.color}|${s.backgroundColor}|${s.borderColor}`;
    }),
  ]);
  expect(overdueStyle, 'expected the overdue row to be visibly distinguished by its rendered styling').not.toBe(futureStyle);
});

test('AC3: adding a todo, with or without a due date, still appears in the list in the new layout', async ({ page }) => {
  await page.goto('/');

  const titleNoDue = `Layout add, no due (${Date.now()})`;
  await page.locator('#title-input').fill(titleNoDue);
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#todo-list li', { hasText: titleNoDue })).toBeVisible();

  const titleWithDue = `Layout add, with due (${Date.now()})`;
  await page.locator('#title-input').fill(titleWithDue);
  await page.locator('#due-input').fill('2027-03-15');
  await page.locator('#add-form button[type="submit"]').click();
  const item = page.locator('#todo-list li', { hasText: titleWithDue });
  await expect(item).toBeVisible();
  await expect(item).toContainText('2027-03-15');
});

test("AC4: changing a todo's due date, toggling it done, and deleting it still work in the new layout", async ({ page }) => {
  await page.goto('/');

  const title = `Layout interactions (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();
  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();

  await item.locator('input.due-edit').fill('2027-04-20');
  await item.locator('input.due-edit').blur();
  await expect(item).toContainText('2027-04-20');

  await item.locator('input[type="checkbox"]').check();
  await expect(item.locator('input[type="checkbox"]')).toBeChecked();

  await item.locator('button.delete-btn').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });
});

test('AC5: sorting by priority and by due date still reorders the list correctly in the new layout', async ({ page }) => {
  await page.goto('/');

  await page.locator('#sort-select').selectOption('due');
  await expect.poll(async () => {
    const text = await page.locator('#todo-list li').allTextContents();
    const indexOf = (t) => text.findIndex((line) => line.includes(t));
    const overdueIndex = indexOf(SEED_OVERDUE);
    const futureIndex = indexOf(SEED_FUTURE);
    const undatedIndex = indexOf(SEED_DONE);
    return overdueIndex >= 0 && futureIndex >= 0 && undatedIndex >= 0 && overdueIndex < futureIndex && futureIndex < undatedIndex;
  }).toBe(true);

  await page.locator('#sort-select').selectOption('priority');
  await expect.poll(async () => {
    const text = await page.locator('#todo-list li').allTextContents();
    return text.findIndex((line) => line.includes(SEED_OVERDUE)) < text.findIndex((line) => line.includes(SEED_FUTURE));
  }).toBe(true);
});

test('AC8: the list can be narrowed to only todos carrying a given tag in the deployed app', async ({ page }) => {
  await page.goto('/');

  const tagButton = page.locator('#tag-filters button[data-tag="errands"]');
  await expect(tagButton).toBeVisible();
  await tagButton.click();

  await expect(page.locator('#todo-list li', { hasText: SEED_OVERDUE })).toBeVisible();
  await expect(page.locator('#todo-list li', { hasText: SEED_FUTURE })).toHaveCount(0);
});

test('AC9: the list can be narrowed to only overdue todos in the deployed app', async ({ page }) => {
  await page.goto('/');

  const overdueButton = page.locator('#filter-overdue');
  await expect(overdueButton).toBeVisible();
  await overdueButton.click();

  await expect(page.locator('#todo-list li', { hasText: SEED_OVERDUE })).toBeVisible();
  await expect(page.locator('#todo-list li', { hasText: SEED_FUTURE })).toHaveCount(0);
  await expect(page.locator('#todo-list li', { hasText: SEED_DONE })).toHaveCount(0);
});

test('AC10: clearing an applied filter returns the deployed app list to its unfiltered state', async ({ page }) => {
  await page.goto('/');

  const overdueButton = page.locator('#filter-overdue');
  await overdueButton.click();
  await expect(page.locator('#todo-list li', { hasText: SEED_FUTURE })).toHaveCount(0);

  await overdueButton.click();
  await expect(page.locator('#todo-list li', { hasText: SEED_OVERDUE })).toBeVisible();
  await expect(page.locator('#todo-list li', { hasText: SEED_FUTURE })).toBeVisible();
  await expect(page.locator('#todo-list li', { hasText: SEED_DONE })).toBeVisible();
});
