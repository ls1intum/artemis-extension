import * as fs from 'fs';
import * as path from 'path';
import { ActivityBar, By, EditorView, SideBarView, until, WebDriver, WebviewView, Workbench } from 'vscode-extension-tester';

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
	// VS Code opens its own "Setup VS Code" walkthrough on a fresh test profile even with
	// `workbench.startupEditor: none` and `walkthroughs.openOnInstall: false`. That walkthrough
	// is itself a webview, and `WebviewView.switchToFrame()` then binds to it instead of the
	// sidebar, so every selector below times out while a screenshot shows the view rendered.
	try {
		await new EditorView().closeAllEditors();
	} catch {
		// Nothing open, which is the state we wanted anyway.
	}
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
 * Stage 0 of the login: type the username and press Continue.
 *
 * The form is two-stage because the server decides per account how it signs in:
 * Continue asks `login-options`, and only the answer says whether stage 1 is a
 * password field, an OIDC redirect, or a note that the extension cannot complete
 * this account's sign-in. Nothing below stage 0 exists before that round-trip, so
 * every caller has to go through here first.
 *
 * Must be called AFTER `switchToWebviewFrame`.
 */
export async function submitUsername(driver: WebDriver, username: string): Promise<void> {
	const usernameInput = await waitForElement(driver, '#username');
	await usernameInput.clear();
	await usernameInput.sendKeys(username);

	const continueButton = await waitForElement(driver, '[data-testid="login-next"]');
	await continueButton.click();
}

/**
 * Perform the standard login sequence: open the Artemis view, go through both
 * stages of the form, wait for navigation to the Dashboard, then switch back to
 * the VS Code host context.
 *
 * Only the password path is driven. An account the server answers with OIDC or
 * SAML2 cannot be signed in from a test at all: one hands off to a browser, the
 * other the extension declines outright.
 */
export async function performLogin(
	driver: WebDriver,
	username: string,
	password: string,
): Promise<void> {
	await openArtemisView();
	await switchToWebviewFrame(driver);

	await submitUsername(driver, username);

	const passwordInput = await waitForElement(driver, '#password');
	await passwordInput.clear();
	await passwordInput.sendKeys(password);

	const submitButton = await waitForElement(driver, '[data-testid="login-submit"]');
	await submitButton.click();

	// Wait for auth + navigation to Dashboard
	await driver.sleep(5000);

	await switchBackFromWebview(driver);
}

/**
 * Navigate from the Dashboard into the first course the account has.
 *
 * The Dashboard lists only courses this profile has opened before, which on a fresh
 * test profile is none, so looking for a course there finds nothing however many
 * selectors are tried. "Browse Courses" opens the full list, where every course is a
 * `course-entry-<id>` row, which is a stated contract rather than a
 * hashed CSS-module class.
 *
 * Returns false when the account genuinely has no course, which is a reason for a
 * suite to skip rather than to fail.
 *
 * Must be called AFTER `switchToWebviewFrame`.
 */
export async function openFirstCourse(driver: WebDriver): Promise<boolean> {
	const browse = await driver
		.findElement(By.xpath("//button[contains(., 'Browse Courses')]"))
		.catch(() => null);
	if (browse) {
		await browse.click();
		await reattachWebviewFrame(driver);
	}

	const course = await driver
		.wait(async () => {
			const rows = await driver.findElements(By.css('[data-testid^="course-entry-"]'));
			return rows.length > 0 ? rows[0] : null;
		}, 10000)
		.catch(() => null);
	if (!course) {
		return false;
	}

	await course.click();
	await reattachWebviewFrame(driver);
	return true;
}

/**
 * Open the first exercise of the course that is currently on screen.
 *
 * Same contract as the course rows: `CourseDetail` marks each exercise row
 * `exercise-entry-<id>`. Returns false when the course has none.
 *
 * Must be called AFTER `openFirstCourse`.
 */
export async function openFirstExercise(driver: WebDriver): Promise<boolean> {
	const exercise = await driver
		.wait(async () => {
			const rows = await driver.findElements(By.css('[data-testid^="exercise-entry-"]'));
			return rows.length > 0 ? rows[0] : null;
		}, 10000)
		.catch(() => null);
	if (!exercise) {
		return false;
	}

	await exercise.click();
	await reattachWebviewFrame(driver);
	return true;
}

/**
 * Re-enter the webview after a navigation inside it.
 *
 * Navigating replaces the whole webview document (the host rewrites
 * `webview.html`), which leaves the driver attached to a frame that no longer
 * exists. Queries against it do not throw, they simply match nothing, so a page
 * that is plainly on screen reads as an empty one.
 */
export async function reattachWebviewFrame(driver: WebDriver): Promise<void> {
	await switchBackFromWebview(driver);
	await driver.sleep(500);
	await switchToWebviewFrame(driver);
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
