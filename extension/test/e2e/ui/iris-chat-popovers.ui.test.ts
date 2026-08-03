// Covers the deterministic half of the conversation-first manual smoke test:
// the keyboard contract of the popover dialogs, and the wording a course with
// Iris switched off produces in the picker.
//
// Skips only when the documented prerequisite is missing (no credentials, see
// .env.example). Everything else stays a failure: a suite that turns each
// breakage into a skip reports green while asserting nothing.
//
// Fixture ids come from ARTEMIS_COURSE_ID / ARTEMIS_DISABLED_COURSE_ID; the
// defaults match the seeded local database.
import * as assert from 'assert';
import { ActivityBar, By, Key, ModalDialog, until, VSBrowser, WebDriver } from 'vscode-extension-tester';

import { getCredentials, performLogin, switchBackFromWebview, switchToWebviewFrame, waitForElement } from './helpers';

/** Fixture courses. Overridable so the suite is not welded to one seeded database. */
const COURSE_WITH_IRIS = Number(process.env.ARTEMIS_COURSE_ID ?? 9026);
const COURSE_WITHOUT_IRIS = Number(process.env.ARTEMIS_DISABLED_COURSE_ID ?? 9027);

const DIALOG = '[role="dialog"]';
const COURSE_OPENER = 'button[class*="courseButton"]';

describe('Iris chat popovers', function () {
	let driver: WebDriver;

	/** Opens the chat panel and leaves the driver inside its webview frame. */
	async function enterChat(): Promise<void> {
		const control = await new ActivityBar().getViewControl('Chat');
		assert.ok(control, 'the Chat view control must exist in the activity bar');
		await control.openView();
		await switchToWebviewFrame(driver);
	}

	async function openCoursePicker(): Promise<void> {
		const opener = await waitForElement(driver, COURSE_OPENER, 15000);
		await opener.click();
		await waitForElement(driver, DIALOG, 5000);
	}

	/** Body text of the webview, so a setup failure names what was on screen. */
	async function describeScreen(): Promise<string> {
		try {
			const text = await driver.executeScript<string>('return document.body.innerText;');
			return (text ?? '').slice(0, 400).replace(/\n+/g, ' | ');
		} catch (error) {
			return `could not read the webview: ${String(error)}`;
		}
	}

	/**
	 * Lands on a course. On a cold profile nothing is tracked yet, so the course
	 * list renders INLINE as the empty transcript and there is no header button
	 * to open a popover from; once a course is open the header button exists.
	 */
	async function ensureCourseOpen(courseId: number): Promise<void> {
		const entry = `[data-testid="course-entry-${courseId}"]`;
		const alreadyListed = await driver.findElements(By.css(entry));
		if (alreadyListed.length === 0) {
			const openers = await driver.findElements(By.css(COURSE_OPENER));
			assert.ok(
				openers.length > 0,
				`neither the inline course list nor the header opener is present. On screen: ${await describeScreen()}`,
			);
			await openers[0].click();
		}
		const target = await waitForElement(driver, entry, 15000);
		await target.click();
		// Both conditions matter: in the warm branch the header already exists
		// before the click, so waiting on it alone would return while the
		// navigation is still in flight. The picker closing is what marks it done.
		await driver.wait(
			async () =>
				(await driver.findElements(By.css(DIALOG))).length === 0
				&& (await driver.findElements(By.css(COURSE_OPENER))).length > 0,
			20000,
			`opening course ${courseId} did not settle. On screen: ${await describeScreen()}`,
		);
	}

	async function dialogIsOpen(): Promise<boolean> {
		return (await driver.findElements(By.css(DIALOG))).length > 0;
	}

	before(async function () {
		this.timeout(180000);
		// Skip ONLY for the documented missing prerequisite (see .env.example);
		// every other failure must stay a failure.
		let credentials;
		try {
			credentials = getCredentials();
		} catch {
			this.skip();
			return;
		}
		const { username, password } = credentials;

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
		await performLogin(driver, username, password);

		// Land on a course first: with nothing open the picker renders inline
		// (the cold-start variant), which has no dialog role by design.
		await enterChat();
		await ensureCourseOpen(COURSE_WITH_IRIS);
		await switchBackFromWebview(driver);
	});

	beforeEach(async function () {
		this.timeout(60000);
		await enterChat();
	});

	afterEach(async function () {
		try {
			await driver.actions().sendKeys(Key.ESCAPE).perform();
		} catch { /* nothing open */ }
		await switchBackFromWebview(driver);
	});

	it('Escape closes the course picker and returns focus to the button that opened it', async function () {
		this.timeout(60000);

		const opener = await waitForElement(driver, COURSE_OPENER, 15000);
		await opener.click();
		await waitForElement(driver, DIALOG, 5000);

		await driver.actions().sendKeys(Key.ESCAPE).perform();
		await driver.wait(async () => !(await dialogIsOpen()), 5000, 'Escape must close the dialog');

		// Identity, not class: two buttons can share a class, and the claim is
		// that focus returns to THIS opener, not to something that looks like it.
		const focused = await driver.switchTo().activeElement();
		assert.strictEqual(
			await focused.getId(),
			await opener.getId(),
			'focus must return to the opener, otherwise a keyboard user is dropped at the document root',
		);
	});

	it('Tab wraps from the last entry of the course picker back to the first', async function () {
		this.timeout(60000);

		await openCoursePicker();

		// Drive the boundary directly instead of tabbing a guessed number of
		// times: the wrap is the whole behaviour, and a fixed count either
		// misses it (more entries than guessed) or lands inside again by
		// accident after focus has already escaped.
		const focusLast = await driver.executeScript<boolean>(`
			var d = document.querySelector('[role="dialog"]');
			if (!d) { return false; }
			var f = d.querySelectorAll('button:not(:disabled), input, [tabindex]:not([tabindex="-1"])');
			if (f.length < 2) { return false; }
			f[f.length - 1].focus();
			return document.activeElement === f[f.length - 1];
		`);
		assert.strictEqual(focusLast, true, 'could not park focus on the last focusable entry');

		await driver.actions().sendKeys(Key.TAB).perform();

		const wrappedToFirst = await driver.executeScript<boolean>(`
			var d = document.querySelector('[role="dialog"]');
			if (!d) { return false; }
			var f = d.querySelectorAll('button:not(:disabled), input, [tabindex]:not([tabindex="-1"])');
			return f.length > 0 && document.activeElement === f[0];
		`);
		assert.strictEqual(wrappedToFirst, true, 'Tab past the last entry must wrap to the first, not leave the dialog');

		await driver.actions().keyDown(Key.SHIFT).sendKeys(Key.TAB).keyUp(Key.SHIFT).perform();

		const wrappedBackToLast = await driver.executeScript<boolean>(`
			var d = document.querySelector('[role="dialog"]');
			if (!d) { return false; }
			var f = d.querySelectorAll('button:not(:disabled), input, [tabindex]:not([tabindex="-1"])');
			return f.length > 0 && document.activeElement === f[f.length - 1];
		`);
		assert.strictEqual(wrappedBackToLast, true, 'Shift+Tab before the first entry must wrap to the last');
	});

	it('a notice sits above the composer and does not stay forever', async function () {
		// Deliberately slow: it waits out the real TTL. The exact 10s boundary is
		// pinned with fake timers in the webview unit tests; this one only proves
		// the notice is transient in the real client.
		this.timeout(120000);

		const newConversation = await waitForElement(driver, 'button[aria-label="New conversation"]', 15000);
		await newConversation.click();

		const notice = await waitForElement(driver, '[role="status"]', 15000);
		assert.match(await notice.getText(), /new conversation/i, 'the notice must say what happened');

		// "Above the composer" is the point of the notice line: below it, a
		// student typing would never see it.
		const aboveComposer = await driver.executeScript<boolean>(`
			var n = document.querySelector('[role="status"]');
			var input = document.querySelector('[aria-label="Chat input"], textarea');
			if (!n || !input) { return false; }
			return n.getBoundingClientRect().bottom <= input.getBoundingClientRect().top + 1;
		`);
		assert.strictEqual(aboveComposer, true, 'the notice must render above the chat input');

		await driver.wait(
			async () => (await driver.findElements(By.css('[role="status"]'))).length === 0,
			25000,
			'the notice must clear itself; a permanent one becomes furniture the student stops reading',
		);
	});

	it('the side menu offers the guide, and the guide actually opens', async function () {
		this.timeout(90000);

		const menu = await waitForElement(driver, 'button[aria-label="Menu"]', 15000);
		await menu.click();

		const items = await driver.findElements(By.xpath('//button[contains(., "Iris Chat Guide")]'));
		assert.strictEqual(items.length, 1, 'the side menu must offer the guide');
		await items[0].click();

		// The guide is a VS Code modal, not a webview element, so it is only
		// reachable from the workbench context.
		await switchBackFromWebview(driver);
		// The webview asks the host to open it, so the modal arrives one round
		// trip later. `getDetails()` does a direct lookup and would race it.
		await driver.wait(
			until.elementLocated(By.className('monaco-dialog-box')),
			15000,
			'the guide modal never appeared',
		);
		const dialog = new ModalDialog();
		const details = await dialog.getDetails();
		assert.match(details, /One conversation at a time/, 'the guide must carry its actual content');

		// Dismiss by keyboard. Clicking the message box's own button proved
		// flaky (ElementNotInteractable on an otherwise identical run), and a
		// modal left standing wedges every test after this one.
		await driver.actions().sendKeys(Key.ESCAPE).perform();
		await driver.wait(
			async () => (await driver.findElements(By.className('monaco-dialog-box'))).length === 0,
			10000,
			'the guide modal stayed open and would block the rest of the suite',
		);
		await enterChat();
	});

	it('choosing a course with Iris switched off says so, and does not invite a retry', async function () {
		this.timeout(60000);

		await openCoursePicker();
		const disabled = await waitForElement(driver, `[data-testid="course-entry-${COURSE_WITHOUT_IRIS}"]`, 10000);
		await disabled.click();

		const alert = await waitForElement(driver, `${DIALOG} [role="alert"]`, 15000);
		const text = await alert.getText();

		assert.match(text, /not enabled|disabled|turned off/i, 'the message must name the actual reason');
		assert.doesNotMatch(text, /try again/i, 'an instructor has to enable it; retrying cannot');
	});
});
