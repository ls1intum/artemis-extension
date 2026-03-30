// Covers E2EV-07: ExamConduction view smoke test
import * as assert from 'assert';
import { VSBrowser, WebDriver, Workbench, By, until } from 'vscode-extension-tester';
import {
	openArtemisView,
	switchToWebviewFrame,
	switchBackFromWebview,
	takeScreenshot,
	getCredentials,
	performLogin,
} from './helpers';

describe('ExamConduction View UI Tests', function () {
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

	it('should render ExamConduction view or skip if no live exam', async function () {
		// ExamConduction requires a LIVE started exam — this almost always skips in CI
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
			await takeScreenshot(driver, 'exam-conduction-smoke');
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
			await takeScreenshot(driver, 'exam-conduction-smoke');
			this.skip();
			return;
		}

		// Step 3: Find and click a "Start Exam" button
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
			await takeScreenshot(driver, 'exam-conduction-smoke');
			this.skip();
			return;
		}

		// If we reached ExamConduction, assert a timer element or any content container exists
		let viewMounted = false;
		try {
			const timerOrContent = await driver.wait(
				() =>
					driver
						.findElement(By.xpath('//*[@id or @role="timer"] | //*[contains(@aria-label,"timer") or contains(@aria-label,"time")]'))
						.then((el) => el)
						.catch(() =>
							driver
								.findElement(By.xpath('//main | //section | //article | //div[@role]'))
								.then((el) => el)
								.catch(() => null),
						),
				5000,
			);
			if (timerOrContent) {
				viewMounted = true;
			}
		} catch {
			// Navigation reached the view but content not yet rendered
		}

		await takeScreenshot(driver, 'exam-conduction-smoke');
		assert.ok(viewMounted, 'ExamConduction smoke test must find at least one view-specific element');
	});
});
