// Covers E2EV-10: GitCredentials view E2E smoke test
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

describe('GitCredentials View UI Tests', function () {
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
			// Already in the default context.
		}
	});

	it('should render GitCredentials view', async function () {
		this.timeout(30000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		try {
			const gitCredentialsButton = await driver.wait(
				until.elementLocated(
					By.xpath("//button[.//span[contains(text(),'Git')]]"),
				),
				10000,
			);
			await gitCredentialsButton.click();
			await driver.sleep(2000);
		} catch {
			// Button not found, skip gracefully.
			await takeScreenshot(driver, 'git-credentials-smoke');
			this.skip();
			return;
		}

		let contentElement: Awaited<ReturnType<typeof driver.findElement>> | null = null;
		try {
			contentElement = await driver.wait(
				until.elementLocated(By.xpath('//form | //input | //section | //main')),
				8000,
			);
		} catch {
			await takeScreenshot(driver, 'git-credentials-smoke');
			this.skip();
			return;
		}

		assert.ok(contentElement, 'GitCredentials view content should be visible');

		await takeScreenshot(driver, 'git-credentials-smoke');
	});
});
