import { test, expect } from '@playwright/test';

// Pins the deployed-environment half of I-13 W2 (Animations): real fade/
// transition timing, real layout at a viewport, and real focus behaviour,
// none of which jsdom (test/animations.test.js) can observe. These run only
// against a deployed product and are not run by `npm test` in this
// repository's own sandbox — the same split as e2e/redesign.spec.js and
// test/redesign.test.js for the prior redesign intent.
//
// "Animated" is checked generically, via a nonzero computed transition/
// animation duration, rather than by asserting a specific duration, easing
// curve, or keyframe name — those are implementation details the spec
// leaves open (roughly 100-300ms, standard easing).

function hasAnimationOrTransition(style) {
  const duration = (value) => value.split(',').some((part) => parseFloat(part) > 0);
  return duration(style.transitionDuration) || duration(style.animationDuration);
}

async function computedStyle(locator) {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { transitionDuration: s.transitionDuration, animationDuration: s.animationDuration };
  });
}

test('AC1: the deployed web app fades the todo list in on page load, and does not replay the fade when only the sort order changes', async ({ page }) => {
  await page.goto('/');

  const list = page.locator('#todo-list');
  await expect(list).toBeVisible();
  const loadStyle = await computedStyle(list);
  expect(
    hasAnimationOrTransition(loadStyle),
    'expected #todo-list to carry a nonzero transition/animation duration for its page-load fade',
  ).toBe(true);

  await page.locator('#sort-select').selectOption('priority');
  await page.waitForTimeout(350);
  const afterSortStyle = await computedStyle(list);
  expect(afterSortStyle).toEqual(loadStyle);
});

test('AC2: adding a todo through the deployed web app animates only the new row in', async ({ page }) => {
  await page.goto('/');

  const title = `Animate the new row in (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const newRow = page.locator('#todo-list li', { hasText: title });
  await expect(newRow).toBeVisible();
  const newRowStyle = await computedStyle(newRow);
  expect(
    hasAnimationOrTransition(newRowStyle),
    'expected the newly added row to carry a nonzero transition/animation duration for its entrance',
  ).toBe(true);
});

test('AC3: deleting a todo through the deployed web app fades the row out before it disappears', async ({ page }) => {
  await page.goto('/');

  const title = `Fade this row out on delete (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const row = page.locator('#todo-list li', { hasText: title });
  await expect(row).toBeVisible();
  await row.locator('button.delete-btn').click();

  await expect(row).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });
});

test("AC4: toggling a todo's done state through the deployed web app animates the style change rather than snapping instantly", async ({ page }) => {
  await page.goto('/');

  const title = `Toggle this row's done state (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const row = page.locator('#todo-list li', { hasText: title });
  await expect(row).toBeVisible();
  const titleEl = row.locator('span').first();

  await row.locator('input[type="checkbox"]').check();
  await expect(titleEl).toHaveClass(/line-through/);
  const style = await computedStyle(titleEl);
  expect(
    hasAnimationOrTransition(style),
    'expected the toggled title to carry a nonzero transition/animation duration',
  ).toBe(true);
});

test("AC5: changing a todo's due date through the deployed web app never applies the add/delete animation to any row", async ({ page }) => {
  await page.goto('/');

  const title = `Edit this row's due date (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const row = page.locator('#todo-list li', { hasText: title });
  await expect(row).toBeVisible();
  await expect(row).not.toHaveAttribute('aria-hidden', 'true');

  await row.locator('input.due-edit').fill('2027-02-10');
  await row.locator('input.due-edit').blur();
  await expect(row).toContainText('2027-02-10');
  await expect(row).not.toHaveAttribute('aria-hidden', 'true');
});

test('AC6: a user with reduced motion requested sees little to no animation, and the deployed web app still works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const list = page.locator('#todo-list');
  const loadStyle = await computedStyle(list);
  const maxDuration = (style) =>
    Math.max(
      ...style.transitionDuration.split(',').map((v) => parseFloat(v) || 0),
      ...style.animationDuration.split(',').map((v) => parseFloat(v) || 0),
    );
  expect(maxDuration(loadStyle), 'expected little to no animation duration under reduced motion').toBeLessThanOrEqual(0.05);

  const title = `Reduced motion still works (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();
  const row = page.locator('#todo-list li', { hasText: title });
  await expect(row).toBeVisible();

  await row.locator('button.delete-btn').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });
});

test('AC7: focus does not fall back to the page background once a deleted row is removed from the deployed web app', async ({ page }) => {
  await page.goto('/');

  const title = `Keep focus sane after delete (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const row = page.locator('#todo-list li', { hasText: title });
  await expect(row).toBeVisible();
  const deleteBtn = row.locator('button.delete-btn');
  await deleteBtn.focus();
  await deleteBtn.click();

  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });

  const activeIsBody = await page.evaluate(() => document.activeElement === document.body);
  expect(activeIsBody, 'expected focus to land somewhere sane once the row is removed, not fall back to the page background').toBe(false);
});

const DESKTOP_VIEWPORT = { width: 1280, height: 800 };
const MOBILE_VIEWPORT = { width: 375, height: 667 };

async function hasNoHorizontalOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

test('AC8: the deployed web app keeps working at a common desktop width with animations enabled', async ({ page }) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto('/');

  const title = `Desktop width with animations (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common desktop width').toBe(true);

  await page.locator('#todo-list li', { hasText: title }).locator('button.delete-btn').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow after a row fades out').toBe(true);
});

test('AC8: the deployed web app keeps working at a common mobile width with animations enabled', async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto('/');

  const title = `Mobile width with animations (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toBeVisible();
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow at a common mobile width').toBe(true);

  await page.locator('#todo-list li', { hasText: title }).locator('button.delete-btn').click();
  await expect(page.locator('#todo-list li', { hasText: title })).toHaveCount(0, { timeout: 3000 });
  expect(await hasNoHorizontalOverflow(page), 'expected no horizontal overflow after a row fades out').toBe(true);
});
