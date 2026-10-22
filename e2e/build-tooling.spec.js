import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the deployed-environment half of AC1/AC2 (I-12 W1): the production
// image must actually build and ship the new styling/build tooling's output,
// while the page it serves stays byte-for-byte the one todo-web serves
// today (no visible change yet). The fixtures below are copies of today's
// public/index.html and public/app.js, taken when this test was written.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXPECTED_INDEX_HTML = readFileSync(path.join(__dirname, 'fixtures', 'index.html'), 'utf8');
const EXPECTED_APP_JS = readFileSync(path.join(__dirname, 'fixtures', 'app.js'), 'utf8');

test('AC1: the deployed web app serves the compiled stylesheet from the new build tooling', async ({ request }) => {
  const res = await request.get('/styles.css');
  expect(res.status(), 'expected the Tailwind build output to be served at /styles.css').toBe(200);
  const body = await res.text();
  expect(body.length, 'expected a non-empty compiled stylesheet').toBeGreaterThan(0);
});

test('AC1: the deployed web app still serves the exact same page and script, byte-for-byte, with no visible change yet', async ({
  request,
}) => {
  const htmlRes = await request.get('/');
  expect(htmlRes.status()).toBe(200);
  expect(await htmlRes.text()).toBe(EXPECTED_INDEX_HTML);

  const jsRes = await request.get('/app.js');
  expect(jsRes.status()).toBe(200);
  expect(await jsRes.text()).toBe(EXPECTED_APP_JS);
});
