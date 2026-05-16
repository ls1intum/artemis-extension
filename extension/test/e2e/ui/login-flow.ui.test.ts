// Covers E2EX-01: Login flow interaction test — credentials → Dashboard
import * as assert from 'assert';
import { By, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    switchBackFromWebview,
    switchToWebviewFrame,
    takeScreenshot,
    waitForElement,
} from './helpers';

describe('Login Flow UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;

	before(async function () {
		this.timeout(30000);

		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
	});

	after(async function () {
		this.timeout(15000);
		const workbench = new Workbench();
		await workbench.executeCommand('Logout from Artemis');
		await driver.sleep(2000);
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default context
		}
	});

	it('should submit login credentials and capture result', async function () {
		this.timeout(30000);

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

		await takeScreenshot(driver, 'login-flow-submitted');

		// Wait for server response
		await driver.sleep(5000);

		await takeScreenshot(driver, 'login-flow-result');
	});

	it('should navigate to Dashboard after successful login', async function () {
		this.timeout(30000);

		// Re-open Artemis view (login was submitted in previous test)
		await openArtemisView();
		await switchToWebviewFrame(driver);

		// After successful login, the view should have navigated to Dashboard
		// Wait for Dashboard heading — any h1 element proves Dashboard mounted
		const heading = await waitForElement(driver, 'h1', 15000);
		assert.ok(heading, 'Dashboard heading should be visible after login');

		// Verify we're not still on the login form
		const loginForms = await driver.findElements(By.css('form #username'));
		assert.strictEqual(
			loginForms.length, 0,
			'Login form should not be visible — should be on Dashboard'
		);

		await takeScreenshot(driver, 'login-flow-dashboard');
	});
});
