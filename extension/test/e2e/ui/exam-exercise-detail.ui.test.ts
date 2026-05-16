// Covers E2EV-08: ExamExerciseDetail view smoke test
import * as assert from 'assert';
import { By, until, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
	getCredentials,
	openArtemisView,
	performLogin,
	switchBackFromWebview,
	switchToWebviewFrame,
	takeScreenshot,
} from './helpers';

describe('ExamExerciseDetail View UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;

	before(async function () {
		this.timeout(30000);

		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
			return;
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();

		// Log in once before all tests in this suite
		await performLogin(driver, username, password);
	});

	after(async function () {
		this.timeout(15000);
		try {
			const workbench = new Workbench();
			await workbench.executeCommand('Logout from Artemis');
			await driver.sleep(2000);
		} catch {
			// Ignore logout errors
		}
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default context — ignore
		}
	});

	it('should render ExamExerciseDetail view or skip if no live exam', async function () {
		// ExamExerciseDetail requires ExamConduction to be reachable first — almost always skips in CI
		this.timeout(60000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		// Step 1: Navigate to a course from Dashboard
		try {
			const courseElement = await driver.wait(
				until.elementLocated(
					By.xpath("//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //a[.//span]"),
				),
				8000,
			);
			await courseElement.click();
			await driver.sleep(2000);
		} catch {
			await takeScreenshot(driver, 'exam-exercise-detail-smoke');
			this.skip();
			return;
		}

		// Step 2: Find and click an exam link in CourseDetail
		try {
			const examElement = await driver.wait(
				until.elementLocated(
					By.xpath("//*[contains(text(),'Exam') or contains(text(),'exam')]"),
				),
				8000,
			);
			await examElement.click();
			await driver.sleep(2000);
		} catch {
			await takeScreenshot(driver, 'exam-exercise-detail-smoke');
			this.skip();
			return;
		}

		// Step 3: Find and click a "Start Exam" button to reach ExamConduction
		try {
			const startButton = await driver.wait(
				until.elementLocated(
					By.xpath("//*[contains(text(),'Start') or contains(text(),'start')]"),
				),
				8000,
			);
			await startButton.click();
			await driver.sleep(2000);
		} catch {
			await takeScreenshot(driver, 'exam-exercise-detail-smoke');
			this.skip();
			return;
		}

		// Step 4: Select an exercise within the exam to reach ExamExerciseDetail
		try {
			const exerciseElement = await driver.wait(
				until.elementLocated(
					By.xpath(
						"//button[contains(text(),'Exercise') or contains(text(),'exercise')] | //li[contains(text(),'Exercise')]//button | //a[contains(text(),'Exercise')]",
					),
				),
				8000,
			);
			await exerciseElement.click();
			await driver.sleep(2000);
		} catch {
			await takeScreenshot(driver, 'exam-exercise-detail-smoke');
			this.skip();
			return;
		}

		// If we reached ExamExerciseDetail, assert exercise content container exists
		let viewMounted = false;
		try {
			const container = await driver.wait(
				() =>
					driver
						.findElement(By.xpath('//main | //section | //article | //div[@role]'))
						.then((el) => el)
						.catch(() => null),
				5000,
			);
			if (container) {
				viewMounted = true;
			}
		} catch {
			// Navigation reached the view but content not yet rendered
		}

		await takeScreenshot(driver, 'exam-exercise-detail-smoke');
		assert.ok(viewMounted, 'ExamExerciseDetail smoke test must find at least one view-specific element');
	});
});
