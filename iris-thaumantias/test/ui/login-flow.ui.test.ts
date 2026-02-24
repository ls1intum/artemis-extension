import { VSBrowser, WebDriver } from 'vscode-extension-tester';
import {
	openArtemisView,
	switchToWebviewFrame,
	switchBackFromWebview,
	waitForElement,
	takeScreenshot,
	getCredentials,
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
});
