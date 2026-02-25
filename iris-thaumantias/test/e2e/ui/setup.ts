import { ExTester, ReleaseQuality } from 'vscode-extension-tester';
import * as path from 'path';

const STORAGE_FOLDER = path.resolve(__dirname, '..', '..', 'test-resources');

/**
 * Programmatic setup for UI tests using ExTester API.
 * Downloads VS Code + ChromeDriver and installs the packaged extension.
 *
 * Usage (from project root):
 *   npx ts-node test/ui/setup.ts
 *
 * Normally you won't call this directly — the `extest setup-and-run` CLI
 * handles setup automatically. This file exists for cases where you need
 * finer-grained control over the setup process.
 */
async function main() {
	const exTester = new ExTester(STORAGE_FOLDER, ReleaseQuality.Stable);

	console.log('Downloading VS Code...');
	await exTester.downloadCode();

	console.log('Downloading ChromeDriver...');
	await exTester.downloadChromeDriver();

	console.log('Installing extension VSIX...');
	await exTester.installVsix();

	console.log('Setup complete.');
}

main().catch((err) => {
	console.error('Setup failed:', err);
	process.exit(1);
});
