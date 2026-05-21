// Covers E2EV-02: Dashboard view smoke test
import * as assert from 'assert';
import { By, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    performLogin,
    switchBackFromWebview,
    switchToWebviewFrame,
    takeScreenshot,
} from './helpers';

describe('Dashboard View UI Tests', function () {
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

		// Log in once before all tests in this suite
		await performLogin(driver, username, password);
	});

	after(async function () {
		// `before()` skips the suite when credentials are missing; in that
		// case `driver` is never assigned and the cleanup below would crash
		// with `Cannot read properties of undefined`. Bail out cleanly.
		if (!driver) { return; }
		this.timeout(15000);
		const workbench = new Workbench();
		await workbench.executeCommand('Logout from Artemis');
		await driver.sleep(2000);
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default context — ignore
		}
	});

	it('should render Dashboard with heading after login', async function () {
		this.timeout(20000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Assert a heading element is visible — smoke test proves the view mounted
		// Use XPath to find any h1 element regardless of CSS module class
		const heading = await driver.wait(
			() =>
				driver
					.findElement(By.xpath('//h1'))
					.then((el) => el)
					.catch(() => null),
			10000,
			'Timed out waiting for Dashboard h1 heading',
		);

		assert.ok(heading, 'Dashboard heading should be visible after login');

		await takeScreenshot(driver, 'dashboard-smoke');
	});
});
