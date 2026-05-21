// Covers E2EX-02: Exercise submission interaction test
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

describe('Exercise Submission Flow UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;
	let exerciseId: string;

	before(async function () {
		this.timeout(30000);

		// Require credentials — skip entire suite if not set
		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
		}

		// Require exercise ID — skip entire suite if not set
		exerciseId = process.env.ARTEMIS_EXERCISE_ID || '';
		if (!exerciseId) {
			this.skip(); // Skip if no exercise ID provided
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();

		// Login first before running submission tests
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

	it('should trigger submission and show build progress', async function () {
		this.timeout(60000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		await takeScreenshot(driver, 'exercise-submission-before-navigate');

		// Step 1: Attempt to navigate to the target exercise
		// Try direct navigation via exercise ID text content first
		const directExercise = await driver
			.findElement(
				By.xpath(
					`//button[contains(text(),'${exerciseId}')] | //a[contains(text(),'${exerciseId}')] | //li[contains(text(),'${exerciseId}')]//button`,
				),
			)
			.catch(() => null);

		if (directExercise) {
			await directExercise.click();
			await driver.sleep(2000);
		} else {
			// Step 2: Navigate through Dashboard → Course → Exercise list
			// Click any course card — CSS module classes are hashed, use structural XPath
			const courseElement = await driver
				.findElement(
					By.xpath(
						"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span] | //button[.//h3] | //button[.//h2]",
					),
				)
				.catch(() => null);

			if (!courseElement) {
				console.log('Exercise submission: No courses available; skipping submission test');
				await takeScreenshot(driver, 'exercise-submission-no-courses');
				this.skip();
				return;
			}

			await courseElement.click();
			await driver.sleep(3000);

			// Step 3: Find and click an exercise within the CourseDetail view
			const exerciseElement = await driver
				.findElement(
					By.xpath(
						"//button[contains(@class,'exercise')] | //a[contains(@href,'exercise')] | //li//button | //li//a",
					),
				)
				.catch(() => null);

			if (!exerciseElement) {
				console.log('Exercise submission: No exercises available in course; skipping submission test');
				await takeScreenshot(driver, 'exercise-submission-no-exercises');
				this.skip();
				return;
			}

			await exerciseElement.click();
			await driver.sleep(2000);
		}

		await takeScreenshot(driver, 'exercise-submission-exercise-loaded');

		// Step 4: Look for a submit or run button using XPath text selectors
		// CSS module classes are hashed — never use class selectors here
		const submitButton = await driver
			.findElement(
				By.xpath(
					"//button[contains(text(),'Submit') or contains(text(),'Run') or contains(text(),'submit')]",
				),
			)
			.catch(() => null);

		if (!submitButton) {
			console.log('Exercise submission: No submit/run button found; skipping submission assertion');
			await takeScreenshot(driver, 'exercise-submission-no-submit-button');
			this.skip();
			return;
		}

		// Step 5: Click the submit button
		await submitButton.click();
		await takeScreenshot(driver, 'exercise-submission-after-click');

		// Step 6: Assert build progress appears within 15 seconds
		// Look for any text indicating build/submission is in progress
		const progressIndicator = await driver
			.wait(
				() =>
					driver
						.findElement(
							By.xpath(
								"//*[contains(text(),'Building') or contains(text(),'Submitting') or contains(text(),'build') or contains(text(),'Progress')]",
							),
						)
						.then((el) => el)
						.catch(() => null),
				15000,
				'Timed out waiting for build progress indicator',
			)
			.catch(() => null);

		await takeScreenshot(driver, 'exercise-submission-after-progress');

		assert.ok(
			progressIndicator,
			'Build progress indicator should appear after submission (Building/Submitting/Progress text)',
		);
	});
});
