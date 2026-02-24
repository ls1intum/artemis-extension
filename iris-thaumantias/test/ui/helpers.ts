import * as fs from 'fs';
import * as path from 'path';
import {
	ActivityBar,
	SideBarView,
	WebviewView,
	VSBrowser,
	By,
	WebDriver,
	until,
} from 'vscode-extension-tester';

// Resolve to the source tree screenshots dir (not the out/ compiled dir)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SCREENSHOTS_DIR = path.join(PROJECT_ROOT, 'test', 'ui', 'screenshots');

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
export async function switchToWebviewFrame(driver: WebDriver): Promise<WebviewView> {
	const webview = new WebviewView();
	await webview.switchToFrame(5000);
	return webview;
}

/**
 * Switch back from the webview iframe to the default VS Code context.
 */
export async function switchBackFromWebview(driver: WebDriver): Promise<void> {
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
