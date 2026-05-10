import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		// Unit tests (default)
		label: 'unit',
		files: 'out/test/unit/**/*.test.js',
		// Exclude struggle-detection tests (run via test:struggle script)
		exclude: ['out/test/unit/struggle-detection/**'],
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
		files: 'out/test/unit/struggle-detection/**/*.test.js',
	},
	{
		// E2E tests (requires running Artemis + Iris)
		label: 'e2e',
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
		files: 'out/test/e2e/recording.e2e.test.js',
		mocha: {
			timeout: 180000,
		},
	},
]);
