// Covers E2EV-01: Login view smoke test
import * as assert from 'assert';
import { By, VSBrowser, WebDriver } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    submitUsername,
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
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in the default context, so ignore.
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

		// Stage 0 only. The password field does not exist yet and must not: which
		// credential this account needs is the server's answer to Continue, not an
		// assumption the form is allowed to make.
		const usernameInput = await waitForElement(driver, '#username');
		assert.ok(usernameInput, 'Username input should be present');

		const continueButton = await waitForElement(driver, '[data-testid="login-next"]');
		assert.ok(continueButton, 'Continue button should be present');

		const passwordFields = await driver.findElements(By.css('#password'));
		assert.strictEqual(passwordFields.length, 0, 'Password field should not be shown before Continue');

		// And the line that says which Artemis this is about to sign in to (#496).
		const serverLine = await waitForElement(driver, '[data-testid="login-server"]');
		assert.ok((await serverLine.getText()).length > 0, 'Server line should name the server');
	});

	it('should accept input in form fields', async function () {
		this.timeout(20000);
		await openArtemisView();
		await switchToWebviewFrame(driver);

		const usernameInput = await waitForElement(driver, '#username');
		await usernameInput.clear();
		await usernameInput.sendKeys(getCredentials().username);
		const usernameValue = await usernameInput.getAttribute('value');
		assert.strictEqual(usernameValue, getCredentials().username, 'Username field should accept input');

		// Stage 1 needs a username the server actually knows, because the field it
		// renders depends on what `login-options` answers for that account.
		await submitUsername(driver, getCredentials().username);

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
