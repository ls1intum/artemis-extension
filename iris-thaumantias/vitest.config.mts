import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			// Stub the vscode module for tests that import extension-host code
			// (e.g. replay engine tests that transitively import types.ts → vscode)
			vscode: new URL('./test/react/__helpers__/vscode.stub.ts', import.meta.url).pathname,
		},
	},
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: ['./test/react/__helpers__/vitest.setup.ts'],
		include: ['test/react/**/*.test.{ts,tsx}'],
		css: true,
		reporters: ['default', 'junit'],
		outputFile: {
			junit: './reports/vitest-results.xml',
		},
		coverage: {
			provider: 'v8',
			reporter: ['text', 'text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage/react',
			include: [
				'src/views/webview/**/*.{ts,tsx}',
			],
			exclude: [
				'**/*.test.{ts,tsx}',
				'**/*.d.ts',
				'**/index.ts',
				'**/types.ts',
				'src/views/webview/**/*.css.ts',
			],
			// Track only — do NOT fail builds (CONTEXT.md decision)
			// thresholds: { /* intentionally not set */ }
		},
	},
});
