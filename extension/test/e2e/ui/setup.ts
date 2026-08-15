import * as path from 'path';
import { ExTester, ReleaseQuality } from 'vscode-extension-tester';

const STORAGE_FOLDER = path.resolve(__dirname, '..', '..', 'test-resources');

/**
 * Programmatic setup for UI tests using the ExTester API: downloads VS Code
 * and ChromeDriver, then installs the packaged extension.
 *
 * Usage, from the extension root: npx ts-node test/e2e/ui/setup.ts
 *
 * The `extest setup-and-run` CLI does this automatically; this file exists for
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
