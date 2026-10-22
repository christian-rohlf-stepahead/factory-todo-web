import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pins the AC1/AC2 build-tooling foundation (I-12 W1): introducing the
// chosen styling/build tooling (Q1: Tailwind CSS, React, and a bundler) must
// not change the page a browser sees today, and must not break the existing
// local suites. The deployed-environment half of AC1/AC2 (the Docker image
// actually builds, and the Playwright e2e suite keeps passing against it) is
// pinned by e2e/build-tooling.spec.js, which this sandbox cannot run.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

function readPackageJson() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
}

function runBuild() {
  return execFileSync('npm', ['run', 'build'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
}

test('AC1: package.json installs the chosen styling/build tooling and declares a build script', () => {
  const pkg = readPackageJson();
  assert.equal(typeof pkg.scripts?.build, 'string', 'expected an npm "build" script that compiles the styling/build tooling');
  assert.ok(pkg.scripts.build.trim().length > 0, 'expected the "build" script to actually run something');

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps.tailwindcss, 'expected "tailwindcss" among the dependencies (Q1: Tailwind CSS)');
  assert.ok(deps.react, 'expected "react" among the dependencies (Q1: the shadcn/ui stack)');
  assert.ok(deps['react-dom'], 'expected "react-dom" among the dependencies (Q1: the shadcn/ui stack)');
});

test('AC1: the Dockerfile still declares the same "web" image and now runs the build before shipping', () => {
  const env = JSON.parse(readFileSync(path.join(REPO_ROOT, '.factory', 'environment.json'), 'utf8'));
  const webImage = env.images.find((image) => image.name === 'web');
  assert.ok(webImage, 'expected the "web" image to still be declared in .factory/environment.json');
  assert.equal(webImage.dockerfile, 'Dockerfile', 'expected the same Dockerfile path as today');
  assert.equal(webImage.context, '.', 'expected the same build context as today');

  const dockerfile = readFileSync(path.join(REPO_ROOT, 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /npm run build/, 'expected the Dockerfile to run the new "build" script while producing the image');
  assert.match(dockerfile, /USER 1001/, 'expected the final image to still run as the numeric non-root user 1001');
  assert.match(dockerfile, /CMD \["node", "src\/index\.js"\]/, 'expected the server to still start the same way');
});

test('AC1: running the build compiles a stylesheet without changing the page or script served today', () => {
  const indexBefore = readFileSync(path.join(PUBLIC_DIR, 'index.html'));
  const appJsBefore = readFileSync(path.join(PUBLIC_DIR, 'app.js'));

  try {
    runBuild();
  } catch (err) {
    assert.fail(`expected \`npm run build\` to succeed: ${err.stderr || err.message}`);
  }

  const stylesPath = path.join(PUBLIC_DIR, 'styles.css');
  assert.ok(existsSync(stylesPath), 'expected the build to compile a stylesheet at public/styles.css');
  assert.ok(readFileSync(stylesPath).length > 0, 'expected a non-empty compiled stylesheet');

  assert.deepEqual(
    readFileSync(path.join(PUBLIC_DIR, 'index.html')),
    indexBefore,
    'expected the build to leave public/index.html byte-for-byte unchanged (no visible change yet)',
  );
  assert.deepEqual(
    readFileSync(path.join(PUBLIC_DIR, 'app.js')),
    appJsBefore,
    'expected the build to leave public/app.js byte-for-byte unchanged (no visible change yet)',
  );
});

test('AC2: after the build, the existing frontend and server test suites still pass unmodified', () => {
  try {
    runBuild();
  } catch (err) {
    assert.fail(`expected \`npm run build\` to succeed before running the existing suites: ${err.stderr || err.message}`);
  }

  try {
    execFileSync(process.execPath, ['--test', 'test/frontend.test.js', 'test/server.test.js'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (err) {
    assert.fail(
      `expected the existing frontend and server tests to still pass unmodified after the build:\n${err.stdout || ''}\n${err.stderr || ''}`,
    );
  }
});
