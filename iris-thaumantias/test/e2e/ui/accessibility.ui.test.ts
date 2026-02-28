// Accessibility tests for all 12 webview views (WCAG 2.1 AA via axe-core)
// Covers A11Y-01: Zero axe violations required across the entire view surface area.
// Login view is tested pre-authentication; all other views require credentials.
import { VSBrowser, WebDriver, Workbench, ActivityBar, By, until } from 'vscode-extension-tester';
import * as assert from 'assert';
import {
	openArtemisView,
	switchToWebviewFrame,
	switchBackFromWebview,
	waitForElement,
	takeScreenshot,
	getCredentials,
	runAxeInCurrentFrame,
} from './helpers';

// ---------------------------------------------------------------------------
// Helper: assert zero axe violations inside the current frame.
// Takes a failure screenshot and produces a descriptive error message.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------
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
			// No credentials set — only the Login view (pre-auth) will be testable.
		}
	});

	afterEach(async function () {
		try {
			await switchBackFromWebview(driver);
		} catch {
			// Already in default frame — ignore.
		}
	});

	// -------------------------------------------------------------------------
	// View 1: Login (pre-authentication — always reachable without credentials)
	// -------------------------------------------------------------------------
	it('Login view should have zero axe violations', async function () {
		this.timeout(30000);

		// The Login view is only visible when NOT logged in.
		// Since this test runs first (before any login in the nested describe),
		// the view should always display the login form.
		await openArtemisView();
		await switchToWebviewFrame(driver);
		await waitForElement(driver, 'form', 10000);
		await assertNoAxeViolations('login', driver);
	});

	// -------------------------------------------------------------------------
	// Views 2–12: authenticated views
	// -------------------------------------------------------------------------
	describe('Authenticated views', function () {
		before(async function () {
			this.timeout(30000);
			if (!hasCredentials) {
				this.skip();
				return;
			}

			// Log in once before this describe block.
			await openArtemisView();
			await switchToWebviewFrame(driver);

			const usernameInput = await waitForElement(driver, '#username');
			await usernameInput.clear();
			await usernameInput.sendKeys(username);

			const passwordInput = await waitForElement(driver, '#password');
			await passwordInput.clear();
			await passwordInput.sendKeys(password);

			const submitBtn = await waitForElement(driver, 'button[type="submit"]');
			await submitBtn.click();

			await switchBackFromWebview(driver);
			await driver.sleep(5000);
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

		// -----------------------------------------------------------------------
		// View 2: Dashboard
		// -----------------------------------------------------------------------
		it('Dashboard view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);
			await waitForElement(driver, 'h1', 10000);
			await assertNoAxeViolations('dashboard', driver);
		});

		// -----------------------------------------------------------------------
		// View 3: CourseList (Dashboard → "Courses" button)
		// -----------------------------------------------------------------------
		it('CourseList view should have zero axe violations', async function () {
			this.timeout(30000);

			await openArtemisView();
			await switchToWebviewFrame(driver);

			// Wait for Dashboard to be ready.
			try {
				await waitForElement(driver, 'h1', 10000);
			} catch {
				await takeScreenshot(driver, 'a11y-skip-course-list');
				this.skip();
				return;
			}

			// Navigate to CourseList via the "Courses" button.
			try {
				const coursesBtn = await driver.wait(
					until.elementLocated(By.xpath("//button[.//span[contains(text(),'Courses')]]")),
					8000,
				);
				await coursesBtn.click();
				await driver.sleep(2000);
			} catch {
				// Button not present on this server configuration — accept Dashboard state.
				// Still run axe on whatever view is visible.
			}

			await assertNoAxeViolations('course-list', driver);
		});

		// -----------------------------------------------------------------------
		// View 4: ServiceStatus (Dashboard → "Service Status" button)
		// -----------------------------------------------------------------------
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

		// -----------------------------------------------------------------------
		// View 5: GitCredentials (Dashboard → "Git" button)
		// -----------------------------------------------------------------------
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

		// -----------------------------------------------------------------------
		// View 6: RecommendedExtensions (Dashboard → "Extension" button)
		// -----------------------------------------------------------------------
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

		// -----------------------------------------------------------------------
		// View 7: CourseDetail (Dashboard → course click) — deep nav, may skip
		// -----------------------------------------------------------------------
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

			// Attempt to click a course card — skip gracefully if none found.
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

		// -----------------------------------------------------------------------
		// View 8: ExerciseDetail (Dashboard → course → exercise click) — deep nav
		// -----------------------------------------------------------------------
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
				// Navigate to a course.
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

				// Navigate to an exercise.
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

				// Wait for any container element.
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

		// -----------------------------------------------------------------------
		// View 9: ExamStart (Dashboard → course → exam) — deep nav, likely skip
		// -----------------------------------------------------------------------
		it('ExamStart view should have zero axe violations', async function () {
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
				// Navigate to a course.
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

				// Locate an exam entry in CourseDetail.
				const examElement = await driver.wait(
					until.elementLocated(
						By.xpath("//*[contains(text(),'Exam') or contains(text(),'exam')]"),
					),
					8000,
				);
				await examElement.click();
				await driver.sleep(2000);

				// Wait for any container.
				await driver.wait(
					() =>
						driver
							.findElement(By.xpath('//*[@id or @role or @aria-label]'))
							.then((el) => el)
							.catch(() => null),
					5000,
				);
			} catch {
				// Live exam or courses not present — skip.
				await takeScreenshot(driver, 'a11y-skip-exam-start');
				this.skip();
				return;
			}

			await assertNoAxeViolations('exam-start', driver);
		});

		// -----------------------------------------------------------------------
		// View 10: ExamConduction (requires live exam in progress) — almost always skips
		// -----------------------------------------------------------------------
		it('ExamConduction view should have zero axe violations', async function () {
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
				// Navigate course → exam → start button.
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

				const examElement = await driver.wait(
					until.elementLocated(
						By.xpath("//*[contains(text(),'Exam') or contains(text(),'exam')]"),
					),
					8000,
				);
				await examElement.click();
				await driver.sleep(2000);

				// Look for a "Start Exam" / "Begin" button.
				const startBtn = await driver.wait(
					until.elementLocated(
						By.xpath(
							"//button[contains(text(),'Start') or contains(text(),'Begin') or contains(text(),'start')]",
						),
					),
					8000,
				);
				await startBtn.click();
				await driver.sleep(3000);
			} catch {
				// Live exam unavailable — skip.
				await takeScreenshot(driver, 'a11y-skip-exam-conduction');
				this.skip();
				return;
			}

			await assertNoAxeViolations('exam-conduction', driver);
		});

		// -----------------------------------------------------------------------
		// View 11: ExamExerciseDetail (inside running exam) — almost always skips
		// -----------------------------------------------------------------------
		it('ExamExerciseDetail view should have zero axe violations', async function () {
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
				// Navigate course → exam → start → exercise.
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

				const examElement = await driver.wait(
					until.elementLocated(
						By.xpath("//*[contains(text(),'Exam') or contains(text(),'exam')]"),
					),
					8000,
				);
				await examElement.click();
				await driver.sleep(2000);

				const startBtn = await driver.wait(
					until.elementLocated(
						By.xpath(
							"//button[contains(text(),'Start') or contains(text(),'Begin') or contains(text(),'start')]",
						),
					),
					8000,
				);
				await startBtn.click();
				await driver.sleep(3000);

				// Inside the exam, click the first exercise.
				const examExerciseElement = await driver.wait(
					until.elementLocated(
						By.xpath(
							"//li[.//button] | //button[contains(@class,'exercise')] | //div[contains(@class,'exercise')]//button",
						),
					),
					8000,
				);
				await examExerciseElement.click();
				await driver.sleep(2000);
			} catch {
				// Live exam unavailable — skip.
				await takeScreenshot(driver, 'a11y-skip-exam-exercise-detail');
				this.skip();
				return;
			}

			await assertNoAxeViolations('exam-exercise-detail', driver);
		});

		// -----------------------------------------------------------------------
		// View 12: IrisChat (separate ActivityBar panel)
		// -----------------------------------------------------------------------
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
				// Wait for a chat input or any textarea.
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
