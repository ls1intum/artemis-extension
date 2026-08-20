import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from '@vscode/test-cli';

// VS Code opens its IPC socket inside the user-data dir, and a unix socket path
// is capped at ~103 characters. The default location is `.vscode-test/user-data`
// INSIDE the checkout, so a deep working copy pushes the socket past the cap and
// Electron dies with EINVAL before a single test runs. Anchoring the user-data
// dir in the OS temp dir keeps the path short regardless of where the repo lives.
// Unique per invocation on purpose: a fixed name would be shared by concurrent
// runs (contending over the profile lock) and by different checkouts, which
// would then inherit each other's settings, auth and extension globalState.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artemis-vsc-'));
const launchArgs = ['--user-data-dir', userDataDir];

// Pin the VS Code build the suites run against, rather than following whatever is current stable.
//
// Two things go wrong without a pin. Resolving 'stable' is a network call on every run, and it has
// already failed a CI job with ETIMEDOUT before a single test executed. And a new stable release could
// turn a pull request red for reasons that have nothing to do with it.
//
// The pin is READ FROM `engines.vscode` instead of being written out here, so there is only one place
// that names a version. That also turns the manifest's compatibility claim into something the suite
// actually verifies: these tests now run on the oldest VS Code the extension says it supports, which is
// where an accidental use of a newer API would show up. Raising `engines.vscode` raises this with it.
//
// The trade-off is deliberate: this no longer notices the day the extension breaks on a NEW VS Code.
// Catching that needs a separate scheduled run against 'stable'.
const { engines } = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const version = engines.vscode.replace(/^[\^~]/, '');

export default defineConfig([
	{
		// Unit tests (default). The glob covers EVERYTHING under out/test/unit,
		// struggle-detection included. This used to carry an
		// `exclude: ['out/test/unit/struggle-detection/**']`, which never did
		// anything: @vscode/test-cli only honours ignore patterns passed as the
		// CLI's `--ignore` flag and drops a config-level `exclude` on the floor
		// (node_modules/@vscode/test-cli/out/cli/gatherFiles.mjs). Those tests
		// therefore always ran here, and running the 'struggle' label alongside
		// this one just executed them a second time. Do not re-add it: if a
		// future release starts honouring `exclude`, the suite would silently
		// shrink by 138 tests, which is the exact rot issue #424 is about.
		label: 'unit',
		version,
		launchArgs,
		files: 'out/test/unit/**/*.test.js',
		coverage: {
			exclude: ['**/test/**', '**/out/test/**'],
		},
		// Deliberately no reporter override: mocha's default `spec` reporter is
		// what makes a failure readable in the CI log. `mocha-junit-reporter`
		// writes XML and nothing else unless `toConsole` is set, and no tooling
		// here reads that XML. (The UI suite is different: run-tests.sh parses
		// its report, so .mocharc.ui.yml keeps the junit reporter.)
	},
	{
		// Struggle detection tests. A focused subset of the 'unit' label above,
		// for iterating on the engine alone. CI runs 'unit', which covers these.
		label: 'struggle',
		version,
		launchArgs,
		files: 'out/test/unit/struggle-detection/**/*.test.js',
	},
	{
		// E2E tests (requires running Artemis + Iris)
		label: 'e2e',
		version,
		launchArgs,
		files: 'out/test/e2e/**/*.e2e.test.js',
		// Recorder E2E is self-contained — run it via the 'recorder-e2e' label instead.
		exclude: ['out/test/e2e/recording.e2e.test.js'],
		mocha: {
			timeout: 60000,
		},
	},
	{
		// Recorder E2E (no Artemis/Iris dependency — drives SessionRecorder
		// directly through the VS Code API in a temp workspace).
		label: 'recorder-e2e',
		version,
		launchArgs,
		files: 'out/test/e2e/recording.e2e.test.js',
		mocha: {
			timeout: 180000,
		},
	},
]);
