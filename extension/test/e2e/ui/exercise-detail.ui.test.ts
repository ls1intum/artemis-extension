// Covers E2EV-05: ExerciseDetail view smoke test
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

	it('should render ExerciseDetail view or accept loading state', async function () {
		// Longer timeout — 2 navigation steps required (Dashboard → Course → Exercise)
		this.timeout(45000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Step 1: Navigate from Dashboard to a Course
		// CSS module classes are hashed — use element type / XPath text selectors only
		const courseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span] | //button[.//h3] | //button[.//h2]",
				),
			)
			.catch(() => null);

		if (!courseElement) {
			// No courses available — skip gracefully
			console.log('ExerciseDetail smoke: No courses available; skipping ExerciseDetail smoke test');
			await takeScreenshot(driver, 'exercise-detail-smoke-no-courses');
			this.skip();
			return;
		}

		await courseElement.click();

		// Wait for CourseDetail to load before looking for exercises
		await driver.sleep(3000);

		// Step 2: Find and click an exercise within the CourseDetail view
		// Use XPath text content selectors to find clickable exercise items
		const exerciseElement = await driver
			.findElement(
				By.xpath(
					"//button[contains(@class,'exercise')] | //a[contains(@href,'exercise')] | //li//button | //li//a",
				),
			)
			.catch(() => null);

		if (!exerciseElement) {
			// No exercises found in this course — skip gracefully
			console.log('ExerciseDetail smoke: No exercises available in course; skipping ExerciseDetail smoke test');
			await takeScreenshot(driver, 'exercise-detail-smoke-no-exercises');
			this.skip();
			return;
		}

		await exerciseElement.click();

		// Wait for ExerciseDetail view to load
		// Assert #participation-section OR any content container
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
