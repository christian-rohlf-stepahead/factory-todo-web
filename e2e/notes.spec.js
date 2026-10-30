import { test, expect } from '@playwright/test';

// Pins I-15 W3's note-editing criteria against the deployed app: adding,
// editing and clearing a todo's note in place, each surviving a reload, so
// together they are AC6's "Playwright test exercises adding, editing and
// clearing a note through the browser". AC1 (display) and AC5 (error on a
// refused note) are pinned in the sandbox instead, in test/notes.test.js,
// since they don't need a real browser or a deployed environment.

test('AC2/AC6: a person can add a note to a todo that has none, in place, through the browser', async ({ page }) => {
  await page.goto('/');

  const title = `Note add check (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  await expect(item).toBeVisible();

  const noteField = item.locator('.note-input');
  await expect(noteField).toHaveValue('');

  const note = 'Ask Priya for the updated figures before the Friday standup';
  await noteField.fill(note);
  await noteField.blur();
  await expect(noteField).toHaveValue(note);

  await page.reload();
  await expect(page.locator('#todo-list li', { hasText: title }).locator('.note-input')).toHaveValue(note);
});

test("AC3/AC6: a person can edit an existing todo's note in place through the browser", async ({ page }) => {
  await page.goto('/');

  const title = `Note edit check (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  const noteField = item.locator('.note-input');
  await noteField.fill('First draft of the note');
  await noteField.blur();
  await expect(noteField).toHaveValue('First draft of the note');

  const revisedNote = 'Revised note after the client call';
  await noteField.fill(revisedNote);
  await noteField.blur();
  await expect(noteField).toHaveValue(revisedNote);

  await page.reload();
  await expect(page.locator('#todo-list li', { hasText: title }).locator('.note-input')).toHaveValue(revisedNote);
});

test("AC4/AC6: a person can clear a todo's note in place through the browser", async ({ page }) => {
  await page.goto('/');

  const title = `Note clear check (${Date.now()})`;
  await page.locator('#title-input').fill(title);
  await page.locator('#add-form button[type="submit"]').click();

  const item = page.locator('#todo-list li', { hasText: title });
  const noteField = item.locator('.note-input');
  await noteField.fill('Temporary note to be cleared');
  await noteField.blur();
  await expect(noteField).toHaveValue('Temporary note to be cleared');

  await noteField.fill('');
  await noteField.blur();
  await expect(noteField).toHaveValue('');

  await page.reload();
  await expect(page.locator('#todo-list li', { hasText: title }).locator('.note-input')).toHaveValue('');
});
