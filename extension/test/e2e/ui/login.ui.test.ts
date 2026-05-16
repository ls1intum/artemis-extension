// Covers E2EV-01: Login view smoke test
import * as assert from 'assert';
import { VSBrowser, WebDriver } from 'vscode-extension-tester';

import {
	openArtemisView,
	switchBackFromWebview,
	switchToWebviewFrame,
	takeScreenshot,
	waitForElement,
} from './helpers';

describe('Login View UI Tests', function () {
	let driver: WebDriver;

	before(async function () {
		this.timeout(30000);
		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
	});

	afterEach(async function () {
		// Always try to switch back to main context after each test
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default context — ignore
		}
	});

	it('should open the Artemis sidebar view', async function () {
		this.timeout(15000);
		const sideBar = await openArtemisView();
		assert.ok(sideBar, 'Artemis sidebar view should be visible');
	});

	it('should render the login form with expected fields', async function () {
		this.timeout(20000);
		await openArtemisView();

		const webview = await switchToWebviewFrame(driver);
		assert.ok(webview, 'Webview should be accessible');

		const form = await waitForElement(driver, 'form');
		assert.ok(form, 'Login form should be present');

		const usernameInput = await waitForElement(driver, '#username');
		assert.ok(usernameInput, 'Username input should be present');

		const passwordInput = await waitForElement(driver, '#password');
		assert.ok(passwordInput, 'Password input should be present');

		const submitButton = await waitForElement(driver, 'button[type="submit"]');
		assert.ok(submitButton, 'Submit button should be present');
	});

	it('should accept input in form fields', async function () {
		this.timeout(20000);
		await openArtemisView();
		await switchToWebviewFrame(driver);

		const usernameInput = await waitForElement(driver, '#username');
		await usernameInput.clear();
		await usernameInput.sendKeys('testuser');
		const usernameValue = await usernameInput.getAttribute('value');
		assert.strictEqual(usernameValue, 'testuser', 'Username field should accept input');

		const passwordInput = await waitForElement(driver, '#password');
		await passwordInput.clear();
		await passwordInput.sendKeys('testpass');
		const passwordValue = await passwordInput.getAttribute('value');
		assert.strictEqual(passwordValue, 'testpass', 'Password field should accept input');
	});

	it('should capture a screenshot of the login view', async function () {
		this.timeout(20000);
		await openArtemisView();

		// Take screenshot before entering the iframe (captures full VS Code window)
		const filepath = await takeScreenshot(driver, 'login-view');
		assert.ok(filepath, 'Screenshot path should be returned');
		assert.ok(filepath.includes('login-view'), 'Screenshot filename should contain "login-view"');
	});
});
