// Captures the screenshots of the student guide in the Artemis documentation
// (documentation/docs/student/tools-reference/vscode-extension/). Run with
// `npm run screenshots:docs`; DEVELOPER.md lists the fixture it expects.
//
// Every capture is an element crop, as the Artemis documentation guideline asks,
// and waits for the content it is meant to show first, so a broken navigation fails
// the run instead of writing an empty or wrong image under the expected name.
//
// The tests run in order and each continues from the screen the previous one left.
import { execFileSync } from 'child_process';
import * as path from 'path';
import { By, EditorView, Key, TextEditor, VSBrowser, WebDriver, WebElement } from 'vscode-extension-tester';

import {
	attachToLoginForm,
	captureElement,
	getCredentials,
	inArtemisView,
	interventionMenu,
	openArtemisView,
	openIrisView,
	reattachWebviewFrame,
	setDeveloperMode,
	setProactiveLevel,
	setSidebarWidth,
	submitUsername,
	switchBackFromWebview,
	switchToWebviewFrame,
	waitForElement,
	waitForText,
	waitUntilIrisIdle,
	xpathLiteral,
} from './helpers';

const SIDEBAR_WIDTH = 460;

const COURSE_TITLE = 'Introduction to Software Engineering';
const ARCHIVED_COURSE_TITLE = 'Fundamentals of Programming';
const STARTED_EXERCISE = 'Sorting with the Strategy Pattern';
const NOT_STARTED_EXERCISE = 'Freelancer Project Scheduling';
const IRIS_QUESTION = 'Some of my tests still fail. Can you give me a hint?';
// What the started exercise shows before and after the build-failure shots, which restore it.
const PARTIAL_RESULT = '5/13 tests';

// The file the build-failure shots break and repair again, inside the workspace repository.
const BROKEN_FILE = path.join('src', 'de', 'tum', 'in', 'ase', 'BubbleSort.java');

describe('Docs screenshots', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;

	before(async function () {
		this.timeout(60000);
		({ username, password } = getCredentials());
		// The run submits code, opens Iris conversations and publishes what it captures, so it
		// only ever runs against the local demo fixture, never against a real account.
		const server = new URL(process.env.ARTEMIS_URL ?? 'https://artemis.tum.de').hostname;
		if (!['localhost', '127.0.0.1'].includes(server)) {
			throw new Error(`Docs screenshots run against a local Artemis only, not ${server}`);
		}
		if (!process.env.ARTEMIS_TEST_REPO) {
			throw new Error('ARTEMIS_TEST_REPO must point at the checkout of the started exercise');
		}
		// The build-failure shots submit everything in the checkout and decide their repair from
		// `git status`, so they need a checkout without changes of its own.
		if (execFileSync('git', ['-C', process.env.ARTEMIS_TEST_REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '') {
			throw new Error(`${process.env.ARTEMIS_TEST_REPO} has uncommitted changes; commit or discard them first`);
		}
		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
		// The window size cannot be set: Electron's ChromeDriver lacks `Browser.getWindowForTarget`,
		// which `setRect` and `getRect` need. Only the sidebar width is pinned, and the run logs the viewport.
		console.log('Viewport:', JSON.stringify(await driver.executeScript('return [window.innerWidth, window.innerHeight, window.devicePixelRatio]')));
		await openArtemisView();
		await setSidebarWidth(driver, SIDEBAR_WIDTH);
	});

	afterEach(async function () {
		await switchBackFromWebview(driver).catch(() => undefined);
	});

	const sidebar = () => driver.findElement(By.id('workbench.parts.sidebar'));
	const editorArea = () => driver.findElement(By.id('workbench.parts.editor'));

	/** Park the pointer on the activity bar, so no row in a capture carries a hover highlight. */
	async function parkPointer(): Promise<void> {
		await driver.actions().move({ origin: await driver.findElement(By.id('workbench.parts.activitybar')), x: 0, y: 200 }).perform();
	}


	/** Capture `target` once `text` is visible in the current sidebar webview. */
	async function captureShowing(name: string, text: string, target: () => Promise<WebElement> = sidebar, timeout = 15000): Promise<void> {
		await switchToWebviewFrame(driver);
		await waitForText(driver, text, timeout);
		await switchBackFromWebview(driver);
		await parkPointer();
		await driver.sleep(500);
		await captureElement(await target(), name);
	}

	/** Click the last clickable element in the current webview frame whose text contains `text`. */
	async function clickText(text: string, timeout = 15000): Promise<void> {
		const el = await driver.wait(
			async () => {
				const found = await driver.findElements(By.xpath(`//*[self::button or self::a or @role='button' or @role='radio' or @data-testid][contains(normalize-space(.), ${xpathLiteral(text)})]`));
				return found.length > 0 ? found[found.length - 1] : null;
			},
			timeout,
			`No clickable element with "${text}"`,
		);
		await (el as WebElement).click();
		await reattachWebviewFrame(driver);
	}

	async function submitWhenEnabled(): Promise<void> {
		await driver.wait(async () => {
			const submit = await driver.findElements(By.xpath("//button[normalize-space(.)='Submit']"));
			return submit.length > 0 && await submit[0].isEnabled();
		}, 30000, 'Submit never became enabled after changing a file');
		await clickText('Submit');
	}

	describe('sign-in', function () {
		it('login-server', async function () {
			this.timeout(60000);
			await attachToLoginForm(driver);
			await waitForElement(driver, '[data-testid="login-server"]');
			await switchBackFromWebview(driver);
			await parkPointer();
			await captureElement(await sidebar(), 'login-server');
		});

		it('login-password', async function () {
			this.timeout(60000);
			await attachToLoginForm(driver);
			await submitUsername(driver, username);
			await waitForElement(driver, '#password');
			await switchBackFromWebview(driver);
			await parkPointer();
			await captureElement(await sidebar(), 'login-password');

			await switchToWebviewFrame(driver);
			const passwordInput = await waitForElement(driver, '#password');
			await passwordInput.sendKeys(password);
			await (await waitForElement(driver, '[data-testid="login-submit"]')).click();
			await driver.sleep(5000);
		});
	});

	describe('courses-and-exercises', function () {
		it('course-list', async function () {
			this.timeout(60000);
			await inArtemisView(driver, async () => {
				await clickText('Browse Courses');
				await clickText('Load Archived Courses');
			});
			await captureShowing('course-list', ARCHIVED_COURSE_TITLE);
		});

		it('course-detail', async function () {
			this.timeout(60000);
			await inArtemisView(driver, async () => {
				const row = await driver.findElement(By.xpath(`//*[starts-with(@data-testid, 'course-entry-')][contains(., ${xpathLiteral(COURSE_TITLE)})]`));
				await row.click();
				await reattachWebviewFrame(driver);
			});
			await captureShowing('course-detail', STARTED_EXERCISE);
		});

		it('exercise-not-started', async function () {
			this.timeout(60000);
			await inArtemisView(driver, () => clickText(NOT_STARTED_EXERCISE));
			await captureShowing('exercise-not-started', 'Start Exercise');
			await inArtemisView(driver, () => clickText('Back to Course'));
		});

		it('exercise-detail', async function () {
			this.timeout(60000);
			await inArtemisView(driver, async () => {
				await clickText(STARTED_EXERCISE);
				// The page shows the default level. Captured first, then switched off, so the broken
				// build below does not set off a real proactive hint that would end up in the chat shots.
				await setProactiveLevel(driver, 'More');
			});
			await captureShowing('exercise-detail', PARTIAL_RESULT);
			await inArtemisView(driver, () => setProactiveLevel(driver, 'Off'));
		});
	});

	describe('work-on-an-exercise', function () {
		it('test-results', async function () {
			this.timeout(60000);
			await inArtemisView(driver, () => clickText('See test results'));
			await captureShowing('test-results', 'Passed');
			await inArtemisView(driver, async () => {
				await driver.actions().sendKeys(Key.ESCAPE).perform(); // closes the overlay
			});
		});

		it('build-failed, build-log, codelens-error', async function () {
			this.timeout(420000);
			// Edited through the editor and saved, not written to disk: the extension tracks
			// uncommitted changes from VS Code's document events, and an outside write does not
			// enable Submit.
			const file = path.join(process.env.ARTEMIS_TEST_REPO!, BROKEN_FILE);
			// A missing semicolon: a compiler error on a known line, which is what the CodeLens annotates.
			const broken = 'input.set(j + 1, temp)';
			const fixed = `${broken};`;
			// Checks the line before changing it, so the repair below is safe to run whether or not
			// the break got as far as the file.
			const setSemicolon = async (present: boolean) => {
				await VSBrowser.instance.openResources(file);
				const editor = new TextEditor();
				const line = await editor.getLineOfText(broken);
				if (line < 1) {
					throw new Error(`${BROKEN_FILE} no longer contains "${broken}"`);
				}
				const text = await editor.getTextAtLine(line);
				if (text.includes(fixed) !== present) {
					await editor.setTextAtLine(line, present ? text.replace(broken, fixed) : text.replace(fixed, broken));
					await editor.save();
				}
				await new EditorView().closeAllEditors();
			};

			try {
				await setSemicolon(false);
				await inArtemisView(driver, submitWhenEnabled);
				await captureShowing('build-failed', 'Go to source', sidebar, 180000);

				await inArtemisView(driver, () => clickText('Open log'));
				await driver.sleep(2000);
				await parkPointer();
				await captureElement(await editorArea(), 'build-log');
				await new EditorView().closeAllEditors();

				await inArtemisView(driver, () => clickText('Go to source'));
				await driver.wait(async () => (await driver.findElements(By.css('.codelens-decoration'))).length > 0, 20000, 'No CodeLens on the failing file');
				await parkPointer();
				await captureElement(await editorArea(), 'codelens-error');
				await new EditorView().closeAllEditors();
			} finally {
				// Put the fixture back even when a step failed: the next run expects the partial
				// result, not a failed build.
				await new EditorView().closeAllEditors().catch(() => undefined);
				await setSemicolon(true);
				// Decided from the repository, not from how far the steps got: after the repair the
				// working tree differs from the last commit exactly when the broken file was committed.
				const repairPending = execFileSync('git', ['-C', process.env.ARTEMIS_TEST_REPO!, 'status', '--porcelain'], { encoding: 'utf8' }).trim() !== '';
				if (repairPending) {
					await inArtemisView(driver, async () => {
						await submitWhenEnabled();
						await waitForText(driver, PARTIAL_RESULT, 180000);
					});
				}
			}
		});

		it('submission-setup', async function () {
			this.timeout(60000);
			await inArtemisView(driver, async () => {
				await clickText('Back to Course');
				await clickText('Back to Dashboard');
				await clickText('Submission Setup');
			});
			await captureShowing('submission-setup', 'Submission Setup');
			await inArtemisView(driver, () => clickText('Back'));
		});

		it('dashboard', async function () {
			this.timeout(60000);
			await captureShowing('dashboard', 'Recent Courses');
		});
	});

	describe('iris', function () {
		it('iris-chat', async function () {
			this.timeout(360000);
			await inArtemisView(driver, async () => {
				await clickText(STARTED_EXERCISE);
				await clickText('Ask');
			});
			await openIrisView();
			await switchToWebviewFrame(driver);
			await waitUntilIrisIdle(driver, 30000);
			// A fresh conversation, so the shot holds only this question and its answer.
			await (await waitForElement(driver, '[aria-label="New conversation"]')).click();
			const input = await waitForElement(driver, '[aria-label="Chat input"]', 20000);
			await input.sendKeys(IRIS_QUESTION);
			await (await waitForElement(driver, '[aria-label="Send message"]')).click();
			await driver.wait(async () => (await driver.findElements(By.css('[data-testid="message-row"]'))).length >= 2, 60000, 'Iris never started answering');
			await waitUntilIrisIdle(driver, 240000);
			// The chat sticks to the bottom while an answer streams in, and its scroll animation can
			// still be running when the answer is complete, pulling a single jump to the top back
			// down. The shot starts at the question, so the jump repeats until the position holds.
			const rows = await driver.findElements(By.css('[data-testid="message-row"]'));
			await driver.wait(async () => {
				const top = await driver.executeScript<number>(`
					let el = arguments[0].parentElement;
					while (el && el.scrollHeight <= el.clientHeight) { el = el.parentElement; }
					if (!el) { return 0; }
					el.scrollTop = 0;
					return el.scrollTop;
				`, rows[0]);
				await driver.sleep(700);
				return top === 0 && await driver.executeScript<boolean>(`
					let el = arguments[0].parentElement;
					while (el && el.scrollHeight <= el.clientHeight) { el = el.parentElement; }
					return !el || el.scrollTop === 0;
				`, rows[0]);
			}, 15000, 'The chat would not stay scrolled to the top');
			await switchBackFromWebview(driver);
			await parkPointer();
			await driver.sleep(1000);
			await captureElement(await sidebar(), 'iris-chat');
		});

		it('iris-context', async function () {
			this.timeout(60000);
			await openIrisView();
			await switchToWebviewFrame(driver);
			await (await waitForElement(driver, '[title="Change topic"]')).click();
			await waitForElement(driver, '[data-testid^="picker-entry-"]');
			await switchBackFromWebview(driver);
			await parkPointer();
			await captureElement(await sidebar(), 'iris-context');
			await switchToWebviewFrame(driver);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
		});

		it('iris-conversations', async function () {
			this.timeout(60000);
			await openIrisView();
			await switchToWebviewFrame(driver);
			await (await waitForElement(driver, '[aria-label="View past conversations"]')).click();
			await driver.sleep(1000);
			await switchBackFromWebview(driver);
			await parkPointer();
			await captureElement(await sidebar(), 'iris-conversations');
			await switchToWebviewFrame(driver);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
		});
	});

	// Proactive help is driven through the developer intervention menu: waiting for the real
	// detector to decide a student is stuck would take minutes and is not reproducible.
	describe('proactive-help', function () {
		before(async function () {
			this.timeout(60000);
			await setDeveloperMode(true);
		});

		after(async function () {
			this.timeout(60000);
			await interventionMenu('Clear mocked surfaces').catch(() => undefined);
			await setDeveloperMode(false).catch(() => undefined);
		});

		/**
		 * Open the exercise file with the cursor on the inner loop, where the mocked hint anchors.
		 * Must run after the last `openArtemisView`, which closes every editor.
		 */
		async function openLoopLine(): Promise<void> {
			// A quick pick left open by the previous menu call would keep the focus from the editor.
			await driver.actions().sendKeys(Key.ESCAPE).perform();
			await VSBrowser.instance.openResources(path.join(process.env.ARTEMIS_TEST_REPO!, BROKEN_FILE));
			const editor = new TextEditor();
			const line = await editor.getLineOfText('for (int j = 0; j < i; j++)');
			await editor.moveCursor(line, 1);
		}

		/** Pick a level in the Artemis view that is already visible, without reopening it (which would close the editor). */
		async function setLevelInVisibleView(level: 'Off' | 'Less' | 'More'): Promise<void> {
			await switchToWebviewFrame(driver);
			try {
				await setProactiveLevel(driver, level);
			} finally {
				await switchBackFromWebview(driver);
			}
		}

		// The surfaces come from the menu's visual mocks: a forced real intervention depends on
		// Iris answering in time and on the detector's cooldown, the mocks render the same banner,
		// inline hint and margin mark every time.
		it('iris-proactive-more', async function () {
			this.timeout(120000);
			await openArtemisView();
			await setLevelInVisibleView('More');
			await openLoopLine();
			await interventionMenu('Mock active proactivity');

			// The banner counts down 15 s, so it is captured as soon as it shows. Only the banner:
			// the page behind it carries the Developer Tools panel that developer mode adds.
			await switchToWebviewFrame(driver);
			const banner = await driver.wait(
				async () => (await driver.findElements(By.xpath("//button[@aria-label='Dismiss nudge']/ancestor::div[.//button[normalize-space(.)='Show me']][1]")))[0] ?? null,
				20000,
				'The proactive banner never appeared',
			);
			await driver.sleep(800); // the banner fades in
			await captureElement(banner as WebElement, 'iris-proactive-more');
			await switchBackFromWebview(driver);

			// The hint after the line is CSS generated content, invisible to a text search; the
			// Iris mark in the margin appears with it.
			await driver.wait(async () => (await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr'))).length > 0, 20000, 'No Iris hint in the editor');
			await parkPointer();
			await captureElement(await editorArea(), 'iris-proactive-inline');
			await interventionMenu('Clear mocked surfaces');
		});

		it('iris-proactive-less', async function () {
			this.timeout(120000);
			await setLevelInVisibleView('Less');
			await openLoopLine();
			await interventionMenu('Mock ambient proactivity');
			await driver.wait(async () => (await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr'))).length > 0, 20000, 'No Iris mark in the editor margin');
			await parkPointer();
			await captureElement(await editorArea(), 'iris-proactive-less');
			await interventionMenu('Clear mocked surfaces');
			await setLevelInVisibleView('More');
		});
	});
});
