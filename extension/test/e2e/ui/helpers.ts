import * as fs from 'fs';
import * as path from 'path';
import { ActivityBar, By, SideBarView, until, WebDriver, WebviewView, Workbench } from 'vscode-extension-tester';

// Resolve to the source tree screenshots dir (not the out/ compiled dir)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'test', 'ui', 'screenshots');

// At runtime __dirname is out/test/e2e/ui/, so four levels up reaches the package root.
const AXE_SOURCE = fs.readFileSync(
	path.resolve(__dirname, '..', '..', '..', '..', 'node_modules', 'axe-core', 'axe.min.js'),
	'utf-8'
);

/**
 * Open the Artemis sidebar view by clicking its activity bar icon.
 * Returns the SideBarView once it is visible.
 */
export async function openArtemisView(): Promise<SideBarView> {
	const activityBar = new ActivityBar();
	const control = await activityBar.getViewControl('Artemis');
	if (!control) {
		throw new Error('Artemis view control not found in activity bar');
	}
	return control.openView();
}

/**
 * Get a WebviewView page object for the Artemis sidebar webview and
 * switch the driver into its iframe context so you can query DOM elements.
 */
export async function switchToWebviewFrame(_driver: WebDriver): Promise<WebviewView> {
	const webview = new WebviewView();
	await webview.switchToFrame(5000);
	return webview;
}

/**
 * Switch back from the webview iframe to the default VS Code context.
 */
export async function switchBackFromWebview(_driver: WebDriver): Promise<void> {
	const webview = new WebviewView();
	await webview.switchBack();
}

/**
 * Wait for a DOM element inside the webview by CSS selector.
 * Must be called AFTER `switchToWebviewFrame`.
 */
export async function waitForElement(
	driver: WebDriver,
	cssSelector: string,
	timeout = 10000,
) {
	return driver.wait(
		until.elementLocated(By.css(cssSelector)),
		timeout,
		`Timed out waiting for element: ${cssSelector}`,
	);
}

/**
 * Read Artemis credentials from environment variables. The canonical names
 * are `ARTEMIS_USER` and `ARTEMIS_PASSWORD` (matching the non-UI E2E tests
 * and `run-e2e-tests.sh`). `ARTEMIS_PASS` is accepted as a fallback for the
 * older UI-test convention.
 *
 * Throws if either is unset.
 */
export function getCredentials(): { username: string; password: string } {
	const username = process.env.ARTEMIS_USER;
	const password = process.env.ARTEMIS_PASSWORD ?? process.env.ARTEMIS_PASS;
	if (!username || !password) {
		throw new Error('Set ARTEMIS_USER and ARTEMIS_PASSWORD environment variables');
	}
	return { username, password };
}

/**
 * Perform the standard login sequence: open the Artemis view, fill in
 * credentials, submit the form, wait for navigation to Dashboard, then
 * switch back to the VS Code host context.
 */
export async function performLogin(
	driver: WebDriver,
	username: string,
	password: string,
): Promise<void> {
	await openArtemisView();
	await switchToWebviewFrame(driver);

	const usernameInput = await waitForElement(driver, '#username');
	await usernameInput.clear();
	await usernameInput.sendKeys(username);

	const passwordInput = await waitForElement(driver, '#password');
	await passwordInput.clear();
	await passwordInput.sendKeys(password);

	const submitButton = await waitForElement(driver, 'button[type="submit"]');
	await submitButton.click();

	// Wait for auth + navigation to Dashboard
	await driver.sleep(5000);

	await switchBackFromWebview(driver);
}

/**
 * Take a PNG screenshot and save it to test/ui/screenshots/.
 * File name format: {name}-{timestamp}.png
 */
export async function takeScreenshot(driver: WebDriver, name: string): Promise<string> {
	if (!fs.existsSync(SCREENSHOTS_DIR)) {
		fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
	}

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `${name}-${timestamp}.png`;
	const filepath = path.join(SCREENSHOTS_DIR, filename);

	const screenshot = await driver.takeScreenshot();
	fs.writeFileSync(filepath, screenshot, 'base64');

	console.log(`Screenshot saved: ${filepath}`);
	return filepath;
}

/**
 * Run axe-core accessibility analysis inside the current webview iframe context.
 * MUST be called AFTER switchToWebviewFrame(): it injects axe into the active frame.
 * Returns axe results with violations array. Zero violations = WCAG 2.1 AA compliant.
 */
export async function runAxeInCurrentFrame(
	driver: WebDriver,
): Promise<{ violations: Array<{ id: string; impact: string; description: string; nodes: unknown[] }> }> {
	await driver.executeScript(AXE_SOURCE);

	const results = await driver.executeAsyncScript(`
		var done = arguments[arguments.length - 1];
		axe.run(document, {
			runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
		}).then(function(r) { done(r); })
		  .catch(function(e) { done({ violations: [], error: e.message }); });
	`);
	return results as { violations: Array<{ id: string; impact: string; description: string; nodes: unknown[] }> };
}

/**
 * Best-effort cleanup for `after()` hooks of credential-gated UI suites.
 * No-op when `driver` is undefined, which covers the case where `before()`
 * skipped the suite (missing credentials) and never assigned `driver`,
 * which would otherwise crash the after-hook with
 * `Cannot read properties of undefined (reading 'sleep')` and mask the
 * intended skip as a real failure.
 */
export async function safeLogoutAndCleanup(driver: WebDriver | undefined): Promise<void> {
	if (!driver) { return; }
	const workbench = new Workbench();
	await workbench.executeCommand('Logout from Artemis');
	await driver.sleep(2000);
}
