// Covers E2EX-02: Exercise submission interaction test
import * as assert from 'assert';
import { By, VSBrowser, WebDriver } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    openFirstCourse,
    openFirstExercise,
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
			const courseOpened = await openFirstCourse(driver);

			if (!courseOpened) {
				console.log('Exercise submission: No courses available; skipping submission test');
				await takeScreenshot(driver, 'exercise-submission-no-courses');
				this.skip();
				return;
			}

			await driver.sleep(3000);

			const exerciseOpened = await openFirstExercise(driver);

			if (!exerciseOpened) {
				console.log('Exercise submission: No exercises available in course; skipping submission test');
				await takeScreenshot(driver, 'exercise-submission-no-exercises');
				this.skip();
				return;
			}

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
			// Submitting needs the repository in the workspace. Without it the view offers
			// Clone instead, which is the correct thing to show and not a missing button:
			// asserting that is what keeps this from passing on an empty view.
			const cloneButton = await driver
				.findElement(By.xpath("//button[contains(., 'Clone Repository')]"))
				.catch(() => null);
			assert.ok(
				cloneButton,
				'Exercise view offers neither a submit action nor a way to get the repository',
			);
			console.log('Exercise submission: repository not in the workspace, so the view offers Clone; skipping the submit assertion');
			await takeScreenshot(driver, 'exercise-submission-clone-offered');
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
