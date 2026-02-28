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
		// E2E tests (requires running Artemis + Iris)
		label: 'e2e',
		files: 'out/test/e2e/**/*.e2e.test.js',
		mocha: {
			timeout: 60000, // 60 seconds for E2E tests
		},
	},
]);
