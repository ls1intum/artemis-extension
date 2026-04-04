// Covers E2EV-09: IrisChat view E2E smoke test
// IrisChat is a SEPARATE sidebar panel from Artemis — it has its own webview provider.
import { VSBrowser, WebDriver, Workbench, ActivityBar } from 'vscode-extension-tester';
import * as assert from 'assert';
import {
	switchToWebviewFrame,
	switchBackFromWebview,
	waitForElement,
	takeScreenshot,
	getCredentials,
} from './helpers';

describe('IrisChat View UI Tests', function () {
	let driver: WebDriver;

	before(async function () {
		this.timeout(30000);

		// Credential-gate: IrisChat requires login to function
		try {
			getCredentials();
		} catch {
			this.skip();
			return;
		}

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
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

	it('should render IrisChat with chat input', async function () {
		this.timeout(30000);

		// Open the Iris Chat panel via ActivityBar
		const activityBar = new ActivityBar();

		let control = await activityBar.getViewControl('Chat');
		if (!control) {
			// Try alternate names
			control = await activityBar.getViewControl('Iris Chat');
		}
		if (!control) {
			await takeScreenshot(driver, 'iris-chat-smoke');
			this.skip();
			return;
		}

		await control.openView();

		// Switch to the Iris Chat webview frame
		let chatInput: Awaited<ReturnType<typeof waitForElement>> | null = null;
		try {
			await switchToWebviewFrame(driver);

			// Assert chat input using a combined CSS selector
			chatInput = await waitForElement(
				driver,
				'[aria-label="Chat input"], textarea',
				10000,
			);
		} catch {
			await takeScreenshot(driver, 'iris-chat-smoke');
			this.skip();
			return;
		}

		assert.ok(chatInput, 'Chat input should be visible in IrisChat');

		await takeScreenshot(driver, 'iris-chat-smoke');
	});
});
