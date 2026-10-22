import { test, expect } from '@playwright/test';

// Pins I-12 W2's two deployed-environment criteria: AC6 — the existing
// deployed-product scenarios (seeded todos display, add, due-date change,
// overdue marking, sort order) keep passing against the restyled app — and
// AC7 — the restyled page is usable at common desktop and mobile widths.
// These run only against a deployed product (see e2e/web.spec.js, which
// already pins the same five scenarios against today's unstyled app); they
// are not run by `npm test` in this repository's own sandbox.
//
// "Restyled" is checked generically, via the presence of component-library
// classes and a real computed-style difference for the overdue row, rather
// than by asserting a specific class name or color — those are
// implementation details of the chosen component library and theme.

const SEEDED_TITLES = ['Renew the parking permit', 'Water the office plants', 'Plan the team offsite'];

async function hasComponentStyling(locator) {
  const className = await locator.getAttribute('class');
  return Boolean(className && className.trim().length > 0);
}

test('AC6: the deployed web app shows the three seeded todos, restyled', async ({ page }) => {
  await page.goto('/');

  const list = page.locator('#todo-list');
  await expect(list).toHaveCount(1);
  expect(await hasComponentStyling(list), 'expected #todo-list to carry component-library classes').toBe(true);

  const items = list.locator('li');
  await expect(items).toHaveCount(3);
  expect(await hasComponentStyling(items.first()), 'expected a todo row to carry component-library classes').toBe(true);

  const text = await items.allTextContents();
  for (const title of SEEDED_TITLES) {
    expect(text.some((line) => line.includes(title))).toBe(true);
  }
});

test('AC6: adding a todo through the restyled deployed web app appears in its list, restyled', async ({ page }) => {
  await page.goto('/');

  const form = page.locator('#add-form');
  expect(await hasComponentStyling(form), 'expected #add-form to carry component-library classes').toBe(true);
  expect(
    await hasComponentStyling(page.locator('#title-input')),
    'expected #title-input to carry component-library classes',
  ).toBe(true);

  const title = `Pack the conference badges (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();
  expect(await hasComponentStyling(item), 'expected the newly added row to carry component-library classes').toBe(true);
});

test("AC6: changing an existing todo's due date through the restyled deployed web app shows the new date", async ({ page }) => {
  await page.goto('/');

  const title = `Confirm the venue booking (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();

  const newDue = '2027-01-20';
  const dueField = item.locator('input.due-edit');
  expect(
    await hasComponentStyling(dueField),
    'expected the due-edit input to carry component-library classes alongside "due-edit"',
  ).toBe(true);
  await dueField.fill(newDue);
  await dueField.blur();

  await expect(item).toContainText(newDue);
});

test('AC6: the seeded overdue todo remains visibly and distinctly styled from a non-overdue todo in the restyled deployed web app', async ({
  page,
}) => {
  await page.goto('/');

  const overdueItem = page.locator('#todo-list li', { hasText: 'Renew the parking permit' });
  const futureItem = page.locator('#todo-list li', { hasText: 'Plan the team offsite' });

  await expect(overdueItem).toHaveClass(/overdue/);
  await expect(futureItem).not.toHaveClass(/overdue/);

  const [overdueStyle, futureStyle] = await Promise.all([
    overdueItem.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.color}|${s.backgroundColor}|${s.borderColor}`;
    }),
    futureItem.evaluate((el) => {
      const s = getComputedStyle(el);
      return `${s.color}|${s.backgroundColor}|${s.borderColor}`;
    }),
  ]);
  expect(
    overdueStyle,
    'expected the overdue row to be visibly distinguished by its rendered styling, not only by an class name',
  ).not.toBe(futureStyle);
});

test('AC6: sorting by due date via the restyled deployed web app shows the seeded todos soonest-first with the undated one last, with a restyled sort control', async ({
  page,
}) => {
  await page.goto('/');

  const sortSelect = page.locator('#sort-select');
  expect(await hasComponentStyling(sortSelect), 'expected #sort-select to carry component-library classes').toBe(true);

  await sortSelect.selectOption('due');

  await expect.poll(async () => {
    const text = await page.locator('#todo-list li').allTextContents();
    const indexOf = (title) => text.findIndex((line) => line.includes(title));
    const overdueIndex = indexOf('Renew the parking permit');
    const futureIndex = indexOf('Plan the team offsite');
    const undatedIndex = indexOf('Water the office plants');
    return overdueIndex >= 0 && futureIndex >= 0 && undatedIndex >= 0 && overdueIndex < futureIndex && futureIndex < undatedIndex;
  }).toBe(true);
});

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 667 };

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('AC7: the restyled page is usable at a common desktop width', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto('/');

  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#title-input')).toBeVisible();
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#todo-list')).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common desktop width').toBe(true);
});

test('AC7: the restyled page is usable at a common mobile width, including adding a todo', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('/');

  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#title-input')).toBeVisible();
  await expect(page.locator('#sort-select')).toBeVisible();
  await expect(page.locator('#todo-list')).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common mobile width').toBe(true);

  const title = `Mobile add check (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  await expect(page.locator('#todo-list li', { hasText: title })).toBeVisible();
});
