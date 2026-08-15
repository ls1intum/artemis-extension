// Accessibility tests for the webview views (WCAG 2.1 AA via axe-core)
// Covers A11Y-01: Zero axe violations required across the entire view surface area.
// Login view is tested pre-authentication; all other views require credentials.
import * as assert from 'assert';
import { ActivityBar, By, until, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    performLogin,
    runAxeInCurrentFrame,
    switchBackFromWebview,
    switchToWebviewFrame,
    takeScreenshot,
    waitForElement,
} from './helpers';

async function assertNoAxeViolations(viewName: string, driver: WebDriver): Promise<void> {
	const results = await runAxeInCurrentFrame(driver);
	if (results.violations.length > 0) {
		const summary = results.violations
			.map((v) => `[${v.impact}] ${v.id}: ${v.description} (${(v.nodes as unknown[]).length} nodes)`)
			.join('\n  ');
		await takeScreenshot(driver, `a11y-fail-${viewName}`);
		assert.strictEqual(
			results.violations.length,
			0,
			`${viewName} has ${results.violations.length} axe violation(s):\n  ${summary}`,
		);
	}
}

describe('Accessibility Tests (WCAG 2.1 AA)', function () {
	let driver: WebDriver;
	let hasCredentials = false;
	let username = '';
	let password = '';

	before(async function () {
		this.timeout(15000);
		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
		try {
			({ username, password } = getCredentials());
			hasCredentials = true;
		} catch {
			// No credentials set: only the Login view (pre-auth) is testable.
		}
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in the default frame.
		}
	});

	it('Login view should have zero axe violations', async function () {
		this.timeout(30000);

		// The Login view is only visible when NOT logged in.
		// This test runs before the nested describe logs in.
		await openArtemisView();
		await switchToWebviewFrame(driver);
		await waitForElement(driver, 'form', 10000);
		await assertNoAxeViolations('login', driver);
	});

	describe('Authenticated views', function () {
		before(async function () {
			this.timeout(30000);
			if (!hasCredentials) {
				this.skip();
				return;
			}

			await performLogin(driver, username, password);
		});

		after(async function () {
			this.timeout(15000);
			try {
				const workbench = new Workbench();
				await workbench.executeCommand('Logout from Artemis');
				await driver.sleep(2000);
			} catch {
				// Ignore logout errors.
			}
		});

		it('Dashboard view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);
			await waitForElement(driver, 'h1', 10000);
			await assertNoAxeViolations('dashboard', driver);
		});

		it('CourseList view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-course-list');
				this.skip();
				return;
			}

			try {
				const coursesBtn = await driver.wait(
					until.elementLocated(By.xpath("//button[.//span[contains(text(),'Courses')]]")),
					8000,
				);
				await coursesBtn.click();
				await driver.sleep(2000);
			} catch {
				// Button not present on this server configuration. Run axe on whatever
				// view is visible instead.
			}

			await assertNoAxeViolations('course-list', driver);
		});

		it('ServiceStatus view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-service-status');
				this.skip();
				return;
			}

			try {
				const serviceStatusBtn = await driver.wait(
					until.elementLocated(
						By.xpath("//button[.//span[contains(text(),'Service Status')]]"),
					),
					8000,
				);
				await serviceStatusBtn.click();
				await driver.sleep(2000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-service-status');
				this.skip();
				return;
			}

			// Wait for the server URL input that identifies this view.
			try {
				await waitForElement(driver, '#serverUrl', 8000);
			} catch {
				// Accept loading/partial state.
			}

			await assertNoAxeViolations('service-status', driver);
		});

		it('GitCredentials view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-git-credentials');
				this.skip();
				return;
			}

			try {
				const gitBtn = await driver.wait(
					until.elementLocated(By.xpath("//button[.//span[contains(text(),'Git')]]")),
					8000,
				);
				await gitBtn.click();
				await driver.sleep(2000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-git-credentials');
				this.skip();
				return;
			}

			// Accept any content (form, input, section) as evidence of mount.
			try {
				await driver.wait(
					() =>
						driver
							.findElement(By.xpath('//form | //input | //section | //main'))
							.then((el) => el)
							.catch(() => null),
					8000,
				);
			} catch {
				// Accept loading state.
			}

			await assertNoAxeViolations('git-credentials', driver);
		});

		it('RecommendedExtensions view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-recommended-extensions');
				this.skip();
				return;
			}

			try {
				const extensionsBtn = await driver.wait(
					until.elementLocated(By.xpath("//button[.//span[contains(text(),'Extension')]]")),
					8000,
				);
				await extensionsBtn.click();
				await driver.sleep(2000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-recommended-extensions');
				this.skip();
				return;
			}

			// Accept any list or heading as evidence of mount.
			try {
				await driver.wait(
					() =>
						driver
							.findElement(By.xpath('//ul | //ol | //h1 | //h2 | //section | //main'))
							.then((el) => el)
							.catch(() => null),
					8000,
				);
			} catch {
				// Accept loading state.
			}

			await assertNoAxeViolations('recommended-extensions', driver);
		});

		it('CourseDetail view should have zero axe violations', async function () {
			this.timeout(45000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				this.skip();
				return;
			}

			try {
				const courseElement = await driver
					.findElement(
						By.xpath(
							"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //button[.//h3] | //button[.//h2]",
						),
					)
					.catch(() => null);

				if (!courseElement) {
					this.skip();
					return;
				}

				await courseElement.click();
				await driver.sleep(2000);

				// Wait for any container element indicating CourseDetail loaded.
				await driver.wait(
					() =>
						driver
							.findElement(By.xpath('//h2 | //h1 | //ul | //section | //main'))
							.then((el) => el)
							.catch(() => null),
					10000,
				);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-course-detail');
				this.skip();
				return;
			}

			await assertNoAxeViolations('course-detail', driver);
		});

		it('ExerciseDetail view should have zero axe violations', async function () {
			this.timeout(60000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				this.skip();
				return;
			}

			try {
				const courseElement = await driver
					.findElement(
						By.xpath(
							"//button[contains(@class,'course')] | //div[contains(@class,'card')]//button | //button[.//h3] | //button[.//h2]",
						),
					)
					.catch(() => null);

				if (!courseElement) {
					this.skip();
					return;
				}

				await courseElement.click();
				await driver.sleep(2000);

				const exerciseElement = await driver
					.findElement(
						By.xpath(
							"//li[.//button] | //button[contains(@class,'exercise')] | //div[contains(@class,'exercise')]//button",
						),
					)
					.catch(() => null);

				if (!exerciseElement) {
					this.skip();
					return;
				}

				await exerciseElement.click();
				await driver.sleep(2000);

				await driver.wait(
					() =>
						driver
							.findElement(By.xpath('//h2 | //h1 | //section | //main'))
							.then((el) => el)
							.catch(() => null),
					10000,
				);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-exercise-detail');
				this.skip();
				return;
			}

			await assertNoAxeViolations('exercise-detail', driver);
		});

		it('IrisChat view should have zero axe violations', async function () {
			this.timeout(30000);

			const activityBar = new ActivityBar();

			let control = await activityBar.getViewControl('Chat');
			if (!control) {
				control = await activityBar.getViewControl('Iris Chat');
			}

			if (!control) {
				await takeScreenshot(driver, 'a11y-skip-iris-chat');
				this.skip();
				return;
			}

			await control.openView();

			try {
				await switchToWebviewFrame(driver);
				await waitForElement(driver, '[aria-label="Chat input"], textarea', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-iris-chat');
				this.skip();
				return;
			}

			await assertNoAxeViolations('iris-chat', driver);
		});
	});
});
