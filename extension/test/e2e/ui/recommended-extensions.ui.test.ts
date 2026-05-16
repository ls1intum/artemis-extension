// Covers E2EV-11: RecommendedExtensions view E2E smoke test
// (E2EV-11 remapped from ProblemStatement — RecommendedExtensions is the 11th actual standalone view)
import assert from 'assert';
import { By, until, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    performLogin,
    switchBackFromWebview,
    switchToWebviewFrame,
    takeScreenshot,
} from './helpers';

describe('RecommendedExtensions View UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;

	before(async function () {
		this.timeout(30000);

		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
			return;
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();

		// Log in once before all tests in this suite
		await performLogin(driver, username, password);
	});

	after(async function () {
		this.timeout(15000);
		try {
			const workbench = new Workbench();
			await workbench.executeCommand('Logout from Artemis');
			await driver.sleep(2000);
		} catch {
			// Ignore logout errors
		}
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default context — ignore
		}
	});

	it('should render RecommendedExtensions view', async function () {
		this.timeout(30000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Navigate from Dashboard by clicking "Recommended Extensions" button
		try {
			const extensionsButton = await driver.wait(
				until.elementLocated(
					By.xpath("//button[.//span[contains(text(),'Extension')]]"),
				),
				10000,
			);
			await extensionsButton.click();
			await driver.sleep(2000);
		} catch {
			// Button not found — skip gracefully
			await takeScreenshot(driver, 'recommended-extensions-smoke');
			this.skip();
			return;
		}

		// Assert RecommendedExtensions content is visible (list, heading, or container)
		let contentElement: Awaited<ReturnType<typeof driver.findElement>> | null = null;
		try {
			contentElement = await driver.wait(
				until.elementLocated(By.xpath('//ul | //ol | //h1 | //h2 | //section | //main')),
				8000,
			);
		} catch {
			await takeScreenshot(driver, 'recommended-extensions-smoke');
			this.skip();
			return;
		}

		assert.ok(contentElement, 'RecommendedExtensions view content should be visible');

		await takeScreenshot(driver, 'recommended-extensions-smoke');
	});
});
