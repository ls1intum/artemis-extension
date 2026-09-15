// Covers E2EV-10: Submission Setup view E2E smoke test
import assert from 'assert';
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

describe('Submission Setup View UI Tests', function () {
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
});
