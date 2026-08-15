// Covers E2EV-04: CourseDetail view smoke test
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

describe('CourseDetail View UI Tests', function () {
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
			// Already in the default context.
		}
	});

	it('should render CourseDetail view or accept loading state', async function () {
		this.timeout(30000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// CSS module classes are hashed, so only element types and XPath text
		// selectors are usable here.
		const courseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span] | //button[.//h3] | //button[.//h2]",
				),
			)
			.catch(() => null);

		if (!courseElement) {
			console.log('CourseDetail smoke: No courses available for CourseDetail smoke test');
			await takeScreenshot(driver, 'course-detail-smoke-no-courses');
			this.skip();
			return;
		}

		await courseElement.click();

		const container = await driver
			.wait(
				() =>
					driver
						.findElement(By.xpath('//h2 | //h1 | //ul | //section | //main'))
						.then((el) => el)
						.catch(() => null),
				10000,
				'Timed out waiting for CourseDetail content',
			)
			.catch(() => null);

		await takeScreenshot(driver, 'course-detail-smoke');

		// Loading and empty states count: this smoke test proves navigation and
		// view mounting, nothing about the content.
		assert.ok(container, 'CourseDetail view should mount and render a container element');
	});
});
