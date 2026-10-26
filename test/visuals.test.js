import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins I-14 W1 (Deployed browser-test visuals): the declared configuration
// that makes every deployed e2e test keep a screenshot, a failed one also
// keep a trace, and none keep a video (AC1-AC4), plus a regression guard
// that the existing suite stays covered by that shared policy (AC5).
//
// playwright.config.js imports '@playwright/test', which this sandbox does
// not install at the repository root (only e2e/ does, for the deployed test
// image - see e2e/package.json), so it is read as source text and matched
// with regexes here rather than imported, the same way test/build-tooling
// .test.js matches the Dockerfile's text instead of running it. Whether the
// five existing e2e files actually keep passing once deployed with this
// policy turned on is confirmed only by the deployed test step itself
// (this sandbox has no browser - see e2e/web.spec.js and friends).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const EXISTING_E2E_FILES = [
  'web.spec.js',
  'terminal.spec.js',
  'redesign.spec.js',
  'animations.spec.js',
  'build-tooling.spec.js',
];

function readEnvironmentJson() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, '.factory', 'environment.json'), 'utf8'));
}

function readPlaywrightConfigSource() {
  return readFileSync(path.join(REPO_ROOT, 'playwright.config.js'), 'utf8');
}

// Extracts the source text of a top-level `key: { ... }` object literal by
// matching braces, since the config is read as text rather than imported.
function extractObjectLiteral(source, key) {
  const opening = source.match(new RegExp(`${key}\\s*:\\s*{`));
  if (!opening) return null;
  let i = opening.index + opening[0].length;
  let depth = 1;
  const start = i;
  while (depth > 0 && i < source.length) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') depth -= 1;
    i += 1;
  }
  return source.slice(start, i - 1);
}

test("AC1: todo-web's .factory/environment.json test step declares a visuals output folder, as an absolute path in the test image", () => {
  const env = readEnvironmentJson();
  assert.ok(env.test, 'expected a "test" step in .factory/environment.json');
  assert.equal(typeof env.test.visuals, 'string', 'expected the "test" step to declare a "visuals" output folder');
  assert.ok(
    path.isAbsolute(env.test.visuals),
    `expected test.visuals ("${env.test.visuals}") to be an absolute path in the test image`,
  );
});

test('AC2: playwright.config.js captures a screenshot for every test, whether it passes or fails', () => {
  const useBlock = extractObjectLiteral(readPlaywrightConfigSource(), 'use');
  assert.ok(useBlock, 'expected a top-level "use" block in playwright.config.js');
  assert.match(
    useBlock,
    /screenshot:\s*['"]on['"]/,
    'expected use.screenshot to be "on" so every test keeps a screenshot, pass or fail',
  );
});

test('AC3: playwright.config.js keeps a trace only for a failed test', () => {
  const useBlock = extractObjectLiteral(readPlaywrightConfigSource(), 'use');
  assert.ok(useBlock, 'expected a top-level "use" block in playwright.config.js');
  assert.match(
    useBlock,
    /trace:\s*['"]retain-on-failure['"]/,
    'expected use.trace to be "retain-on-failure" so only a failed test keeps its trace',
  );
});

test('AC4: playwright.config.js and the deployed test step produce no video recordings', () => {
  const useBlock = extractObjectLiteral(readPlaywrightConfigSource(), 'use');
  assert.ok(useBlock, 'expected a top-level "use" block in playwright.config.js');
  assert.match(
    useBlock,
    /video:\s*['"]off['"]/,
    'expected use.video to be explicitly "off" so the deployed test step produces no video recordings',
  );
});

test('AC5: every existing e2e test file stays in the suite, under the same shared screenshot/trace/no-video policy', () => {
  const configSource = readPlaywrightConfigSource();
  const useBlock = extractObjectLiteral(configSource, 'use');
  assert.ok(useBlock, 'expected a top-level "use" block in playwright.config.js');
  assert.match(useBlock, /screenshot:\s*['"]on['"]/, 'expected the shared screenshot policy to be turned on');
  assert.match(useBlock, /trace:\s*['"]retain-on-failure['"]/, 'expected the shared trace policy to be turned on');
  assert.match(useBlock, /video:\s*['"]off['"]/, 'expected the shared video policy to stay off');

  for (const file of EXISTING_E2E_FILES) {
    const filePath = path.join(REPO_ROOT, 'e2e', file);
    assert.ok(existsSync(filePath), `expected e2e/${file} to still be part of the suite`);
    const source = readFileSync(filePath, 'utf8');
    assert.doesNotMatch(
      source,
      /test\.use\(/,
      `expected e2e/${file} not to override the shared screenshot/trace/video policy with its own test.use(...)`,
    );
  }
});
