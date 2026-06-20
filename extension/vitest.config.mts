import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	// Build-time constants injected by esbuild's `define` in the real build
	// (esbuild.js). Mirror them here so webview components that reference them
	// (App.tsx, DashboardView.tsx, StruggleDetectionView.tsx) run under vitest.
	// Tests exercise full-build behaviour, so both are true.
	define: {
		__IRIS_RECORDING__: 'true',
		__IRIS_TELEMETRY__: 'true',
	},
	resolve: {
		alias: {
			// Stub the vscode module for tests that import extension-host code
			// (e.g. replay engine tests that transitively import types.ts → vscode)
			vscode: new URL('./test/react/__helpers__/vscode.stub.ts', import.meta.url).pathname,
			// Path aliases — kept in sync with tsconfig.json "paths".
			'@extension': new URL('./src/extension', import.meta.url).pathname,
			'@webview': new URL('./src/webview', import.meta.url).pathname,
			'@shared': new URL('./src/shared', import.meta.url).pathname,
			'@test': new URL('./test', import.meta.url).pathname,
			'@root/package.json': new URL('./package.json', import.meta.url).pathname,
		},
	},
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: ['./test/react/__helpers__/vitest.setup.ts'],
		include: ['test/react/**/*.test.{ts,tsx}', 'test/logic/**/*.test.{ts,tsx}'],
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
				'src/webview/**/*.{ts,tsx}',
			],
			exclude: [
				'**/*.test.{ts,tsx}',
				'**/*.d.ts',
				'**/index.ts',
				'**/types.ts',
				'src/webview/**/*.css.ts',
			],
			// Track only — do NOT fail builds (CONTEXT.md decision)
			// thresholds: { /* intentionally not set */ }
		},
	},
});
