import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			// Stub the vscode module for tests that import extension-host code
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
		include: ['test/golden-replay/**/*.test.{ts,tsx}'],
	},
});
