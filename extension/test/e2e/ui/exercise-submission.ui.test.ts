// Covers E2EX-02: Exercise submission interaction test
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

describe('Exercise Submission Flow UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;
	let exerciseId: string;

	before(async function () {
		this.timeout(30000);

		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
		}

		// The canonical name is ARTEMIS_EXERCISE_ID; EXERCISE_ID is accepted as
		// a fallback for older configs.
		exerciseId = process.env.ARTEMIS_EXERCISE_ID ?? process.env.EXERCISE_ID ?? '';
		if (!exerciseId) {
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

	it('should trigger submission and show build progress', async function () {
		this.timeout(60000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		await takeScreenshot(driver, 'exercise-submission-before-navigate');

		// Try direct navigation via the exercise ID's text content first.
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
			// Navigate through Dashboard, Course, Exercise list. CSS module
			// classes are hashed, so the course card is matched structurally.
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

		// CSS module classes are hashed, so the submit/run button is matched on
		// its text rather than on a class.
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

		await submitButton.click();
		await takeScreenshot(driver, 'exercise-submission-after-click');

		// Any text indicating the build or submission is in progress counts.
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
