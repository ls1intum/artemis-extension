import { defineConfig } from '@vscode/test-cli';

export default defineConfig([
	{
		// Unit tests (default)
		label: 'unit',
		files: 'out/test/**/*.test.js',
		// Exclude e2e tests from unit test run
		exclude: ['out/test/e2e/**'],
		coverage: {
			exclude: ['**/test/**', '**/out/test/**'],
		},
	},
	{
		// E2E tests (requires running Artemis + Iris)
		label: 'e2e',
		files: 'out/test/e2e/**/*.e2e.test.js',
		mocha: {
			timeout: 60000, // 60 seconds for E2E tests
		},
	},
]);
