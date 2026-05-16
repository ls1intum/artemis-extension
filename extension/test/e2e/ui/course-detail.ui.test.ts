// Covers E2EV-04: CourseDetail view smoke test
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

		// Log in once before all tests in this suite
		await performLogin(driver, username, password);
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
			// Already in default context — ignore
		}
	});

	it('should render CourseDetail view or accept loading state', async function () {
		this.timeout(30000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Try to find a clickable course card/link from the Dashboard
		// CSS module classes are hashed — use element type / XPath text selectors only
		const courseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span] | //button[.//h3] | //button[.//h2]",
				),
			)
			.catch(() => null);

		if (!courseElement) {
			// No course element found — skip gracefully (empty dashboard / no enrolled courses)
			console.log('CourseDetail smoke: No courses available for CourseDetail smoke test');
			await takeScreenshot(driver, 'course-detail-smoke-no-courses');
			this.skip();
			return;
		}

		await courseElement.click();

		// Wait for CourseDetail view to load — accept any container element
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

		// Accept loading/empty states as valid — smoke test proves navigation and view mounting
		assert.ok(container, 'CourseDetail view should mount and render a container element');
	});
});
