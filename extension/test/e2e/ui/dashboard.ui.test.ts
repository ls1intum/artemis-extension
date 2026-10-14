// Covers E2EV-02: Dashboard view smoke test
import * as assert from 'assert';
import { By, VSBrowser, WebDriver } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    performLogin,
    safeLogoutAndCleanup,
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

		await performLogin(driver, username, password);
	});

	after(async function () {
		this.timeout(15000);
		await safeLogoutAndCleanup(driver);
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in the default context, ignore.
		}
	});

	it('should render Dashboard with heading after login', async function () {
		this.timeout(20000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// XPath so the h1 is found regardless of its CSS module class.
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

	// The sign-in used to request the courses while the session was still
	// resolving; the transition to authenticated then discarded the answer and
	// the dashboard stayed without courses until something asked again.
	it('has an answer for the courses right after sign-in', async function () {
		this.timeout(20000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		const answered = await driver.wait(async () => {
			const rows = await driver.findElements(By.xpath("//h2[normalize-space(.)='Recent Courses']/ancestor::*[.//button[@aria-expanded]][1]//button[@aria-expanded]"));
			const none = await driver.findElements(By.xpath("//*[normalize-space(.)='You are not enrolled in any course yet.']"));
			return rows.length > 0 || none.length > 0;
		}, 15000).catch(() => false);
		const failed = await driver.findElements(By.xpath("//*[normalize-space(.)='Courses could not be loaded.']"));

		assert.ok(answered && failed.length === 0, 'Recent Courses must show the courses (or a real empty answer) after sign-in');
	});
});
