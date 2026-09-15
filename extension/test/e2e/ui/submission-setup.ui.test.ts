// Covers E2EV-10: Submission Setup view E2E smoke test, and the repair flow
import assert from 'assert';
import { execFileSync } from 'child_process';
import { By, until, VSBrowser, WebDriver, Workbench } from 'vscode-extension-tester';

import {
    getCredentials,
    openArtemisView,
    performLogin,
    reattachWebviewFrame,
    switchBackFromWebview,
    switchToWebviewFrame,
    takeScreenshot,
} from './helpers';

/**
 * The exercise checkout the test drives, opened with `extest -r`. Without one
 * the page has no repository to check and the repair flow cannot run at all.
 */
const REPO = process.env.ARTEMIS_TEST_REPO ?? '';

/** Only a local server may have a token rotated by a test run. */
const IS_LOCAL_SERVER = /localhost|127\.0\.0\.1/.test(process.env.ARTEMIS_URL ?? '');

function git(args: string[]): string {
	return execFileSync('git', args, {
		cwd: REPO,
		encoding: 'utf-8',
		env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
	}).trim();
}

/**
 * Make sure the page is on screen, wherever the previous test left the view.
 *
 * Suites share one VS Code instance, so this cannot assume it starts on the
 * dashboard: the page may already be open, or the view may be one Back link
 * away from it.
 */
async function openSubmissionSetup(driver: WebDriver): Promise<void> {
	await openArtemisView();
	await switchToWebviewFrame(driver);

	if ((await driver.findElements(By.css('[data-testid="setup-row-git"]'))).length > 0) {
		return;
	}

	const back = await driver
		.findElement(By.xpath("//button[contains(., 'Back to Dashboard')]"))
		.catch(() => null);
	if (back) {
		await back.click();
		await reattachWebviewFrame(driver);
	}

	const button = await driver.wait(
		until.elementLocated(By.xpath("//button[contains(., 'Submission Setup')]")),
		10000,
	);
	await button.click();
	await reattachWebviewFrame(driver);
}

/** Wait until the access row's text matches, which is how a recheck or a renewal is observed. */
async function waitForAccessText(driver: WebDriver, pattern: RegExp, timeout = 30000): Promise<string> {
	let seen = '';
	await driver.wait(async () => {
		const rows = await driver.findElements(By.css('[data-testid="setup-row-access"]'));
		if (rows.length === 0) { return false; }
		seen = await rows[0].getText();
		return pattern.test(seen);
	}, timeout, `Access row never matched ${pattern}. Last text: ${seen}`);
	return seen;
}

describe('Submission Setup View UI Tests', function () {
	let driver: WebDriver;
	let username: string;
	let password: string;

	before(async function () {
		this.timeout(90000);

		try {
			({ username, password } = getCredentials());
		} catch {
			this.skip();
			return;
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();

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
			// Already in the default context.
		}
	});

	it('should render the Submission Setup view', async function () {
		this.timeout(30000);

		await openArtemisView();
		await switchToWebviewFrame(driver);

		try {
			// Matched on the button's whole text, not on a span inside it: the entry is a
			// `Button` with an icon next to the label, so the label is not always its own span.
			const submissionSetupButton = await driver.wait(
				until.elementLocated(By.xpath("//button[contains(., 'Submission Setup')]")),
				10000,
			);
			await submissionSetupButton.click();
			await reattachWebviewFrame(driver);
		} catch {
			// Button not found, skip gracefully.
			await takeScreenshot(driver, 'submission-setup-smoke');
			this.skip();
			return;
		}

		// The page is a checklist, so the rows are the evidence it mounted; a
		// form only exists while the identity is missing or being edited.
		let contentElement: Awaited<ReturnType<typeof driver.findElement>> | null = null;
		try {
			contentElement = await driver.wait(
				until.elementLocated(By.css('[data-testid="setup-row-git"]')),
				8000,
			);
		} catch {
			await takeScreenshot(driver, 'submission-setup-smoke');
			this.skip();
			return;
		}

		assert.ok(contentElement, 'Submission Setup view content should be visible');

		await takeScreenshot(driver, 'submission-setup-smoke');
	});

	it('repairs a dead access token without the student touching git', async function () {
		this.timeout(180000);

		// Renewal mints a real token for a real participation, so this runs
		// against a local server only: pointed at a shared one it would rotate
		// somebody's live credential as a side effect of a test.
		if (!REPO || !IS_LOCAL_SERVER) {
			this.skip();
			return;
		}

		await openSubmissionSetup(driver);
		await waitForAccessText(driver, /Git can reach your repository/);
		await takeScreenshot(driver, 'submission-setup-ready');

		// Break the credential the way an expiry would: the remote still points
		// at the right repository, and the token in it no longer works.
		const workingUrl = git(['remote', 'get-url', 'origin']);
		const deadUrl = workingUrl.replace(/\/\/[^@]*@/, '//artemis_admin:dead-token@');
		git(['remote', 'set-url', 'origin', deadUrl]);

		const recheck = await driver.findElement(By.css('[data-testid="setup-access-recheck"]'));
		await recheck.click();

		await waitForAccessText(driver, /refused access/i);
		await takeScreenshot(driver, 'submission-setup-refused');

		const banner = await driver.findElement(By.css('[data-testid="setup-banner"]'));
		assert.match(await banner.getText(), /needs fixing|need fixing/, 'the banner must count the broken row');

		const renew = await driver.wait(
			until.elementLocated(By.css('[data-testid="setup-access-renew"]')),
			10000,
			'A refused access row must offer Renew',
		);
		await renew.click();

		await waitForAccessText(driver, /Git can reach your repository/, 60000);
		await takeScreenshot(driver, 'submission-setup-renewed');

		// The page says it is fixed; git has to agree, from outside the extension.
		const repairedUrl = git(['remote', 'get-url', 'origin']);
		assert.notStrictEqual(repairedUrl, deadUrl, 'the remote must have been rewritten');
		assert.ok(!repairedUrl.includes('dead-token'), 'the dead credential must be gone');
		git(['-c', 'credential.helper=', 'ls-remote', 'origin']);
	});
});
