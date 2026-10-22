import { test, expect } from '@playwright/test';

// Pins the deployed-environment half of AC1/AC2 (I-12 W1): the production
// image must actually build and ship the styling/build tooling's output.
// W1 additionally pinned that the served page stayed byte-for-byte
// unchanged (no visible change yet); that invariant was specific to W1's
// own milestone and is deliberately superseded now that I-12 W2 applies the
// visual redesign on top of this tooling (see e2e/redesign.spec.js, which
// pins the restyled page instead).

test('AC1: the deployed web app serves the compiled stylesheet from the new build tooling', async ({ request }) => {
  const res = await request.get('/styles.css');
  expect(res.status(), 'expected the Tailwind build output to be served at /styles.css').toBe(200);
  const body = await res.text();
  expect(body.length, 'expected a non-empty compiled stylesheet').toBeGreaterThan(0);
});
