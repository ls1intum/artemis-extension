import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	test: {
		globals: true,
		environment: 'happy-dom',
		setupFiles: ['./test/react/__helpers__/vitest.setup.ts'],
		include: ['test/react/**/*.test.{ts,tsx}'],
		css: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'text-summary', 'html', 'lcov'],
			reportsDirectory: './coverage/react',
			include: [
				'src/views/webview/react/**/*.{ts,tsx}',
			],
			exclude: [
				'**/*.test.{ts,tsx}',
				'**/*.d.ts',
				'**/index.ts',
				'**/types.ts',
				'src/views/webview/react/**/*.css.ts',
			],
			// Track only — do NOT fail builds (CONTEXT.md decision)
			// thresholds: { /* intentionally not set */ }
		},
	},
});
