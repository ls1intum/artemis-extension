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

export default defineConfig([
	{
		// Unit tests (default). Runs everything under out/test/unit/**
		// (including the struggle-engine tests under
		// out/test/unit/services/struggle/**); the former v1 'struggle' label
		// was retired with the v1 decision path in PR 2c.
		label: 'unit',
		launchArgs,
		files: 'out/test/unit/**/*.test.js',
		coverage: {
			exclude: ['**/test/**', '**/out/test/**'],
		},
		mocha: {
			reporter: 'mocha-junit-reporter',
			reporterOptions: {
				mochaFile: './reports/mocha-results.xml',
			},
		},
	},
	{
		// Struggle detection tests
		label: 'struggle',
		launchArgs,
		files: 'out/test/unit/struggle-detection/**/*.test.js',
	},
	{
		// E2E tests (requires running Artemis + Iris)
		label: 'e2e',
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
		launchArgs,
		files: 'out/test/e2e/recording.e2e.test.js',
		mocha: {
			timeout: 180000,
		},
	},
]);
