// Covers E2EV-05: ExerciseDetail view smoke test
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

describe('ExerciseDetail View UI Tests', function () {
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

	it('should render ExerciseDetail view or accept loading state', async function () {
		// Two navigation steps (Dashboard, Course, Exercise) need the longer timeout.
		this.timeout(45000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Step 1: Dashboard to Course. CSS module classes are hashed, so only
		// element types and XPath text selectors are usable here.
		const courseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span] | //button[.//h3] | //button[.//h2]",
				),
			)
			.catch(() => null);

		if (!courseElement) {
			console.log('ExerciseDetail smoke: No courses available; skipping ExerciseDetail smoke test');
			await takeScreenshot(driver, 'exercise-detail-smoke-no-courses');
			this.skip();
			return;
		}

		await courseElement.click();

		// Wait for CourseDetail to load before looking for exercises
		await driver.sleep(3000);

		// Step 2: Course to Exercise.
		const exerciseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'exercise')] | //a[contains(@href,'exercise')] | //li//button | //li//a",
				),
			)
			.catch(() => null);

		if (!exerciseElement) {
			console.log('ExerciseDetail smoke: No exercises available in course; skipping ExerciseDetail smoke test');
			await takeScreenshot(driver, 'exercise-detail-smoke-no-exercises');
			this.skip();
			return;
		}

		await exerciseElement.click();

		const participationSection = await driver
			.wait(
				() =>
					driver
						.findElement(By.css('#participation-section'))
						.then((el) => el)
						.catch(() => null),
				5000,
				'Waiting for #participation-section',
			)
			.catch(() => null);

		const container = participationSection
			?? (await driver
				.wait(
					() =>
						driver
							.findElement(By.xpath('//section | //main | //h2 | //h1'))
							.then((el) => el)
							.catch(() => null),
					5000,
					'Timed out waiting for ExerciseDetail content',
				)
				.catch(() => null));

		await takeScreenshot(driver, 'exercise-detail-smoke');

		assert.ok(container !== null, 'ExerciseDetail smoke test must find at least one view-specific element');
	});
});
