// Records the screencast of the student guide: a silent video of the published extension,
// from the Marketplace install to proactive help, which gets a voice-over afterwards. Run with
// `npm run screencast:docs`; DEVELOPER.md lists the fixture it expects.
//
// The spec records the whole display with ffmpeg and writes a timeline of its scenes and of
// the waits nobody should watch (builds, Iris thinking). `scripts/render-screencast.js` cuts
// the waits out and writes the final video and the voice-over as subtitles.
//
// The scenes run in order and each continues from the screen the previous one left.
import { ChildProcess, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActivityBar, By, EditorView, Key, SettingsEditor, TextEditor, VSBrowser, WebDriver, WebElement, Workbench } from 'vscode-extension-tester';

import {
	getCredentials,
	interventionMenu,
	reattachWebviewFrame,
	setDeveloperMode,
	setSidebarWidth,
	switchBackFromWebview,
	switchToWebviewFrame,
	waitForElement,
	waitUntilIrisIdle,
	xpathLiteral,
} from './helpers';

const COURSE_TITLE = 'Introduction to Software Engineering';
const EXERCISE_TITLE = 'Sorting with the Strategy Pattern';
const EXTENSION_ID = 'aet-tum.iris-thaumantias';
const EXTENSION_NAME = 'Artemis - TUM';
const SIDEBAR_WIDTH = 460;
const IRIS_QUESTION = 'Why do my MergeSort tests still fail?';
const BUBBLE_SORT = path.join('src', 'de', 'tum', 'in', 'ase', 'BubbleSort.java');
const MERGE_SORT = path.join('src', 'de', 'tum', 'in', 'ase', 'MergeSort.java');

// Typed on camera into the template's empty `performSort`, one entry per line. The editor's
// auto-indent and auto-closing are off in screencast-settings.json, so what is typed is what
// ends up in the file.
const BUBBLE_SORT_BODY = [
	'        for (int i = input.size() - 1; i >= 0; i--) {',
	'            for (int j = 0; j < i; j++) {',
	'                if (input.get(j).compareTo(input.get(j + 1)) > 0) {',
	'                    final Date temp = input.get(j);',
	'                    input.set(j, input.get(j + 1));',
	'                    input.set(j + 1, temp);',
	'                }',
	'            }',
	'        }',
];

// What the "online code editor" commits for the Pull Changes scene: the template's MergeSort with
// its TODO spelled out, so the change is visible in the open editor tab.
const MERGE_SORT_ONLINE_EDIT = `package de.tum.in.ase;

import java.util.*;

public class MergeSort {

    /**
     * Sorts dates with MergeSort.
     *
     * @param input the List of Dates to be sorted
     */
    public void performSort(final List<Date> input) {

        // TODO: split the list in half, sort both halves, then merge them
    }

}
`;

// The clone folder, as the folder picker returns it and VS Code opens it as the workspace
// (screencast-settings.json opens the picker there). Files are opened under this path: the
// extension ignores saves outside the workspace path, and /private/tmp would count as outside.
const CLONE_FOLDER = '/tmp/artemis-exercises';
// The same folder resolved, which the preflight empties. Fixed rather than configurable so the
// deletion can only ever hit this one demo folder.
const CLONE_ROOT = path.join(fs.realpathSync('/tmp'), 'artemis-exercises');

// At runtime __dirname is out/test/e2e/ui/, so four levels up reaches the package root.
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const OUT_DIR = path.join(PACKAGE_ROOT, 'reports', 'screencast');

const RECORD = process.env.SCREENCAST_RECORD !== '0';
const UNTIL = Number(process.env.SCREENCAST_UNTIL ?? Infinity);

// The recorded voice-over, one file per sentence (scene01-00.wav, ...), as
// scripts/screencast-recorder writes it. Without a take, a sentence is timed at a calm pace.
const VOICE_DIR = path.join(OUT_DIR, 'voice');
const WORDS_PER_SECOND = 2.3;
// Silence between two sentences of a scene, and after a scene's last sentence.
const SENTENCE_GAP_MS = 250;
const SCENE_TAIL_MS = 800;

interface SentenceRecord { index: number; text: string; at: number }
interface SceneRecord { id: number; title: string; voiceOver: string; start: number; end: number; sentences: SentenceRecord[] }
interface Cut { start: number; end: number }

/** Minimal Artemis REST client for the preflight. Bearer auth only: Artemis rejects a request carrying a JWT cookie and a bearer token. */
class ArtemisClient {
	private token = '';

	constructor(private readonly baseUrl: string) { }

	async login(username: string, password: string): Promise<void> {
		const response = await fetch(`${this.baseUrl}/api/core/public/authenticate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, password, rememberMe: false }),
		});
		if (!response.ok) {
			throw new Error(`Login as ${username} failed with ${response.status}`);
		}
		this.token = ((await response.json()) as { access_token: string }).access_token;
	}

	async request<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
		const response = await fetch(`${this.baseUrl}${apiPath}`, {
			method,
			headers: { Authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!response.ok) {
			throw new Error(`${method} ${apiPath} failed with ${response.status}`);
		}
		const text = await response.text();
		return (text ? JSON.parse(text) : undefined) as T;
	}
}

/** Size of a PNG from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
	const header = Buffer.alloc(24);
	const fd = fs.openSync(file, 'r');
	try {
		fs.readSync(fd, header, 0, 24, 0);
	} finally {
		fs.closeSync(fd);
	}
	return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/**
 * The avfoundation index of the display VS Code is on, found by grabbing one frame of each
 * screen and comparing its size with the window's screen in device pixels.
 */
function findCaptureDisplay(width: number, height: number): number {
	if (process.env.SCREENCAST_DISPLAY) {
		return Number(process.env.SCREENCAST_DISPLAY);
	}
	const probe = path.join(OUT_DIR, 'display-probe.png');
	for (let index = 0; index < 6; index++) {
		try {
			execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '30', '-i', `Capture screen ${index}:none`, '-frames:v', '1', probe], { stdio: 'ignore', timeout: 20000 });
		} catch {
			break;
		}
		const size = pngSize(probe);
		fs.rmSync(probe, { force: true });
		if (size.width === width && size.height === height) {
			return index;
		}
	}
	throw new Error(`No capture screen of ${width}x${height}; set SCREENCAST_DISPLAY`);
}

/** The pointer drawn into the workbench, since Selenium clicks without moving the system cursor. */
const POINTER_SCRIPT = `
	if (!document.getElementById('screencast-pointer')) {
		const pointer = document.createElement('div');
		pointer.id = 'screencast-pointer';
		// Built node by node: the workbench enforces Trusted Types, which rejects innerHTML.
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '26');
		svg.setAttribute('height', '26');
		svg.setAttribute('viewBox', '0 0 24 24');
		const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		arrow.setAttribute('d', 'M5 2.5l14 9.2-6.3 1.4-3.3 6.4z');
		arrow.setAttribute('fill', '#1b1b1b');
		arrow.setAttribute('stroke', '#ffffff');
		arrow.setAttribute('stroke-width', '1.6');
		arrow.setAttribute('stroke-linejoin', 'round');
		svg.appendChild(arrow);
		pointer.appendChild(svg);
		Object.assign(pointer.style, {
			position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none',
			transition: 'transform 650ms cubic-bezier(.4,0,.2,1)', transform: 'translate(55vw, 45vh)',
			filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))',
		});
		document.body.appendChild(pointer);
	}
`;

describe('Screencast', function () {
	this.bail(true);

	let driver: WebDriver;
	let username: string;
	let password: string;
	let student: ArtemisClient;
	let admin: ArtemisClient;
	let courseId: number;
	let exerciseId: number;
	let repo: string;

	let recorder: ChildProcess | undefined;
	let recordingStart = 0;
	// The compiled pointer.swift; only set while recording.
	let pointerTool: string | undefined;
	const scenes: SceneRecord[] = [];
	const cuts: Cut[] = [];

	const now = () => Date.now() - recordingStart;
	const cutTotal = () => cuts.reduce((sum, cut) => sum + cut.end - cut.start, 0);
	// Time as the finished video counts it: footage cut out does not advance it.
	const keptNow = () => now() - cutTotal();

	// The scene being recorded: its sentences, the ones already marked, and when the voice of the
	// last marked one ends, in kept time.
	let sceneId = 0;
	let sentences: string[] = [];
	let spoken: SentenceRecord[] = [];
	let voiceEndsAt = 0;

	/** Splits a voice-over into sentences the way the recorder does, so take N is sentence N. */
	function splitSentences(voiceOver: string): string[] {
		return voiceOver.split(/(?<=[.!?])\s+/).filter(Boolean);
	}

	function sentenceMs(index: number): number {
		const take = path.join(VOICE_DIR, `scene${String(sceneId).padStart(2, '0')}-${String(index).padStart(2, '0')}.wav`);
		if (fs.existsSync(take)) {
			const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', take]).toString());
			if (seconds > 0) {
				return seconds * 1000;
			}
		}
		return sentences[index].split(/\s+/).length / WORDS_PER_SECOND * 1000;
	}

	/** Waits until the voice of the sentences marked so far has ended. */
	async function settle(): Promise<void> {
		const wait = voiceEndsAt - keptNow();
		if (wait > 0) {
			await driver.sleep(wait);
		}
	}

	/**
	 * Marks where sentence `index` of the scene's voice-over starts: call it right before the
	 * action the sentence describes. It first waits until the previous sentence has been spoken,
	 * so the footage paces itself to the voice. Skipped sentences are marked here first.
	 */
	async function say(index: number): Promise<void> {
		if (index < spoken.length || index >= sentences.length) {
			throw new Error(`Scene ${sceneId}: sentence ${index + 1} is marked twice or does not exist`);
		}
		while (spoken.length <= index) {
			if (spoken.length < index) {
				console.log(`Scene ${sceneId}: sentence ${spoken.length + 1} has no marker of its own`);
			}
			if (spoken.length > 0) {
				voiceEndsAt += SENTENCE_GAP_MS;
				await settle();
			}
			spoken.push({ index: spoken.length, text: sentences[spoken.length], at: now() });
			voiceEndsAt = keptNow() + sentenceMs(spoken.length - 1);
		}
	}

	/** Run `body` as footage nobody should watch; the render step cuts it out. */
	async function offCamera(body: () => Promise<void>): Promise<void> {
		const start = now();
		try {
			await body();
		} finally {
			cuts.push({ start, end: now() });
		}
	}

	/**
	 * One scene of the video. The body marks each sentence of the voice-over with `say` at the
	 * action it describes; the scene ends once the last sentence has been spoken.
	 */
	function scene(id: number, title: string, voiceOver: string, timeout: number, body: () => Promise<void>): void {
		it(`${id}. ${title}`, async function () {
			if (id > UNTIL) {
				this.skip();
			}
			this.timeout(timeout);
			sceneId = id;
			sentences = splitSentences(voiceOver);
			spoken = [];
			voiceEndsAt = keptNow();
			const start = now();
			await body();
			await switchBackFromWebview(driver).catch(() => undefined);
			if (spoken.length < sentences.length) {
				await say(sentences.length - 1);
			}
			voiceEndsAt += SCENE_TAIL_MS;
			await settle();
			scenes.push({ id, title, voiceOver, start, end: now(), sentences: spoken });
		});
	}

	// --- pointer -----------------------------------------------------------------------------

	async function injectPointer(): Promise<void> {
		await driver.executeScript(POINTER_SCRIPT);
	}

	/** Glide the drawn pointer to a point of the workbench, in CSS pixels. Must run in the workbench context. */
	async function glideTo(x: number, y: number): Promise<void> {
		await driver.executeScript(`document.getElementById('screencast-pointer').style.transform = 'translate(${Math.round(x - 5)}px, ${Math.round(y - 2)}px)';`);
		await driver.sleep(750);
	}

	/** A short ring where the pointer clicks. Must run in the workbench context. */
	async function pulseAt(x: number, y: number): Promise<void> {
		await driver.executeScript(`
			const ring = document.createElement('div');
			Object.assign(ring.style, {
				position: 'fixed', left: '${Math.round(x - 14)}px', top: '${Math.round(y - 14)}px', width: '28px', height: '28px',
				borderRadius: '50%', border: '3px solid rgba(0, 101, 189, .8)', zIndex: '2147483646', pointerEvents: 'none',
			});
			document.body.appendChild(ring);
			ring.animate([{ transform: 'scale(.4)', opacity: 1 }, { transform: 'scale(1.4)', opacity: 0 }], { duration: 450 }).onfinish = () => ring.remove();
		`);
		await driver.sleep(250);
	}

	/** Runs pointer.swift with a point given in the workbench's CSS pixels. */
	async function systemPointer(mode: 'to' | 'away', x: number, y: number): Promise<void> {
		if (!pointerTool) {
			return;
		}
		const [screenX, screenY] = await driver.executeScript<number[]>('return [window.screenX, window.screenY]');
		execFileSync(pointerTool, [mode, String(Math.round(screenX + x)), String(Math.round(screenY + y))]);
	}

	/**
	 * Parks the system pointer out of the recording: avfoundation records it although ffmpeg is
	 * told not to, and it would sit still next to the drawn pointer for the whole video.
	 */
	async function parkSystemPointer(): Promise<void> {
		const [width, height] = await driver.executeScript<number[]>('return [window.innerWidth, window.innerHeight]');
		await systemPointer('away', width / 2, height / 2);
	}

	/** Centre of a workbench element, in workbench CSS pixels. */
	async function workbenchCentre(element: WebElement): Promise<{ x: number; y: number }> {
		const rect = await element.getRect();
		return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	}

	/**
	 * Centre of an element of the sidebar webview, in workbench CSS pixels. The element sits two
	 * frames deep (the webview iframe, then its `#active-frame`), so both frame origins are added.
	 * Starts and ends inside the webview.
	 */
	async function webviewCentre(element: WebElement): Promise<{ x: number; y: number }> {
		const inner = await driver.executeScript<number[]>(`
			arguments[0].scrollIntoView({ block: 'nearest' });
			const r = arguments[0].getBoundingClientRect();
			return [r.left + r.width / 2, r.top + r.height / 2];
		`, element);
		await driver.switchTo().parentFrame();
		const activeFrame = await driver.executeScript<number[]>(`
			const r = document.getElementById('active-frame').getBoundingClientRect();
			return [r.left, r.top];
		`);
		await driver.switchTo().parentFrame();
		const sidebar = await driver.findElement(By.id('workbench.parts.sidebar')).getRect();
		let outer: { x: number; y: number } | undefined;
		for (const frame of await driver.findElements(By.css('iframe.webview.ready'))) {
			const r = await frame.getRect();
			if (r.width > 0 && r.x + r.width / 2 > sidebar.x && r.x + r.width / 2 < sidebar.x + sidebar.width) {
				outer = r;
				break;
			}
		}
		if (!outer) {
			throw new Error('No webview iframe over the sidebar');
		}
		const point = { x: outer.x + activeFrame[0] + inner[0], y: outer.y + activeFrame[1] + inner[1] };
		await switchToWebviewFrame(driver);
		return point;
	}

	/** Point at a workbench element, optionally clicking it. */
	async function pointWorkbench(element: WebElement, click = true): Promise<void> {
		const { x, y } = await workbenchCentre(element);
		await glideTo(x, y);
		if (click) {
			await pulseAt(x, y);
			await element.click();
		}
	}

	/** Point at an element of the sidebar webview, optionally clicking it. Starts and ends inside the webview. */
	async function pointWebview(element: WebElement, click = true): Promise<void> {
		const { x, y } = await webviewCentre(element);
		await switchBackFromWebview(driver);
		await glideTo(x, y);
		if (click) {
			await pulseAt(x, y);
		}
		await switchToWebviewFrame(driver);
		if (click) {
			await element.click();
		}
	}

	/** The last element in the current webview frame whose text contains `text`, clickable ones first. */
	async function findByText(text: string, timeout = 15000): Promise<WebElement> {
		return driver.wait(async () => {
			const clickable = await driver.findElements(By.xpath(`//*[self::button or self::a or @role='button' or @role='radio' or @data-testid][contains(normalize-space(.), ${xpathLiteral(text)})]`));
			if (clickable.length > 0) {
				return clickable[clickable.length - 1];
			}
			const any = await driver.findElements(By.xpath(`//*[text()[contains(normalize-space(.), ${xpathLiteral(text)})]]`));
			return any.length > 0 ? any[any.length - 1] : null;
		}, timeout, `Nothing with "${text}"`) as Promise<WebElement>;
	}

	/**
	 * Wait until `text` shows in the sidebar webview. Some actions replace the webview's document
	 * a moment later (starting an exercise, signing in), which leaves the driver in a frame that
	 * matches nothing, so the frame is entered again on every poll.
	 */
	async function waitForPage(text: string, timeout = 30000): Promise<void> {
		const deadline = Date.now() + timeout;
		for (;;) {
			if ((await driver.findElements(By.xpath(`//*[contains(normalize-space(.), ${xpathLiteral(text)})]`)).catch(() => [])).length > 0) {
				return;
			}
			if (Date.now() > deadline) {
				throw new Error(`"${text}" never appeared`);
			}
			await driver.sleep(1000);
			await reattachWebviewFrame(driver).catch(() => undefined);
		}
	}

	/** Point at and click the element with `text` in the webview, then follow it if the click navigated. */
	async function clickText(text: string, navigates = false): Promise<void> {
		await pointWebview(await findByText(text));
		if (navigates) {
			await reattachWebviewFrame(driver);
		}
	}

	async function hoverText(text: string, holdMs = 900): Promise<void> {
		await pointWebview(await findByText(text), false);
		await driver.sleep(holdMs);
	}

	/** Follow the Back links of the Artemis view until the dashboard shows. Must run inside the view. */
	async function backToDashboard(): Promise<void> {
		for (let step = 0; step < 4; step++) {
			if ((await driver.findElements(By.xpath("//*[contains(normalize-space(.), 'Tools & Settings')]"))).length > 0) {
				return;
			}
			const back = await driver.findElements(By.xpath("//button[starts-with(normalize-space(.), 'Back')] | //a[starts-with(normalize-space(.), 'Back')]"));
			if (back.length === 0) {
				break;
			}
			await pointWebview(back[0]);
			await reattachWebviewFrame(driver);
		}
		await waitForPage('Tools & Settings', 15000);
	}

	/** Type into the active text editor one character at a time, as a person would. */
	async function typeInEditor(editor: TextEditor, text: string, perCharMs = 12): Promise<void> {
		for (const char of text) {
			await editor.typeText(char);
			if (perCharMs > 0) {
				await driver.sleep(perCharMs);
			}
		}
	}

	/**
	 * Clicks the last token of the editor line containing `word` and moves the caret to the end of
	 * that line. ExTester's line lookups and cursor moves open the command palette or quick open,
	 * which would be on camera. One word only: Monaco renders spaces as &nbsp;.
	 */
	async function caretToLineEnd(word: string): Promise<TextEditor> {
		const token = await driver.findElement(By.xpath(`(//div[contains(@class, 'view-lines')]/div[contains(@class, 'view-line')][contains(., ${xpathLiteral(word)})]/span/span)[last()]`));
		await pointWorkbench(token);
		// Keys go to the editor's input element; the session's pointer actions do not reach it.
		const editor = new TextEditor();
		await editor.typeText(Key.END);
		await driver.sleep(400);
		return editor;
	}

	async function typeIntoFocus(text: string, perCharMs = 45): Promise<void> {
		// ExTester's command palette chord can leave Cmd+Shift held in the session's input state,
		// which turns typed letters into shortcuts (Shift+Cmd+E opens the Explorer).
		await driver.actions().clear();
		for (const char of text) {
			await driver.actions().sendKeys(char).perform();
			await driver.sleep(perCharMs);
		}
	}

	async function typeSlowly(element: WebElement, text: string, perCharMs = 45): Promise<void> {
		for (const char of text) {
			await element.sendKeys(char);
			await driver.sleep(perCharMs);
		}
	}

	// --- VS Code -----------------------------------------------------------------------------

	/** Enter the Artemis view's webview without closing the editors, which `openArtemisView` does. */
	async function artemisFrame(): Promise<void> {
		await switchBackFromWebview(driver).catch(() => undefined);
		const control = await new ActivityBar().getViewControl('Artemis');
		if (!control) {
			throw new Error('Artemis view control not found in the activity bar');
		}
		await control.openView();
		await switchToWebviewFrame(driver);
	}

	async function irisFrame(): Promise<void> {
		await switchBackFromWebview(driver).catch(() => undefined);
		const control = await new ActivityBar().getViewControl('Iris Chat');
		if (!control) {
			throw new Error('Iris Chat view control not found in the activity bar');
		}
		await control.openView();
		await switchToWebviewFrame(driver);
	}

	/** Point at an activity bar icon and open its view. */
	async function openFromActivityBar(title: string): Promise<void> {
		const control = await driver.wait(async () => (await new ActivityBar().getViewControl(title)) ?? null, 60000, `No "${title}" in the activity bar`);
		const icon = await control!.findElement(By.css('.action-label'));
		await pointWorkbench(icon, false);
		await control!.openView();
	}

	/**
	 * Back to the Artemis view on the exercise page, reloaded off camera. The released build drops
	 * the exercise description when the view becomes visible again on an exercise page (the
	 * visibility refresh renders no new one). Leaves the driver inside the Artemis view.
	 */
	async function returnToExercisePage(): Promise<void> {
		await offCamera(async () => {
			await switchBackFromWebview(driver);
			await new ActivityBar().getViewControl('Artemis').then(control => control?.openView());
			await artemisFrame();
			await (await waitForElement(driver, '[title="Reload Exercise"]', 15000)).click();
			await waitForPage('You have the following tasks', 30000);
		});
	}

	/** Simple fullscreen covers the display without a new Space, which is what the recording captures. */
	async function ensureFullscreen(): Promise<void> {
		const isFull = () => driver.executeScript<boolean>('return window.innerHeight >= screen.height - 2 && window.innerWidth >= screen.width - 2');
		// The command palette is not usable for a moment after the window opens.
		for (let attempt = 1; !(await isFull()); attempt++) {
			try {
				await new Workbench().executeCommand('View: Toggle Full Screen');
				await driver.wait(isFull, 10000);
			} catch (error) {
				if (attempt === 3) {
					throw new Error(`VS Code did not go fullscreen: ${error}`);
				}
				await driver.actions().sendKeys(Key.ESCAPE).perform();
				await driver.sleep(2000);
			}
		}
		await driver.sleep(1000);
	}

	async function openFile(relative: string): Promise<TextEditor> {
		await VSBrowser.instance.openResources(path.join(repo, relative));
		return new TextEditor();
	}

	/** The checkout the clone scene created; the repository folder is named after the participation. */
	function findRepo(): string {
		const entries = fs.readdirSync(CLONE_ROOT).filter(name => fs.existsSync(path.join(CLONE_ROOT, name, '.git')));
		if (entries.length !== 1) {
			throw new Error(`Expected one repository in ${CLONE_ROOT}, found ${entries.length}`);
		}
		return path.join(CLONE_FOLDER, entries[0]);
	}

	async function participationId(): Promise<number | undefined> {
		const details = await student.request<{ exercise: { studentParticipations?: { id: number }[] } }>('GET', `/api/exercise/exercises/${exerciseId}/details`);
		return details.exercise.studentParticipations?.[0]?.id;
	}

	async function latestResultId(participation: number): Promise<number | undefined> {
		const result = await student.request<{ id?: number } | undefined>('GET', `/api/programming/programming-exercise-participations/${participation}/latest-result-with-feedbacks?withSubmission=true`).catch(() => undefined);
		return result?.id;
	}

	/** Submit from the exercise page and keep the build out of the video, apart from its first seconds. */
	async function submitAndWait(expected: string): Promise<void> {
		const submit = await driver.wait(async () => {
			const buttons = await driver.findElements(By.xpath("//button[normalize-space(.)='Submit']"));
			return buttons.length > 0 && await buttons[0].isEnabled() ? buttons[0] : null;
		}, 30000, 'Submit never became enabled') as WebElement;
		await pointWebview(submit);
		await driver.sleep(3000);
		await offCamera(() => waitForPage(expected, 240000));
	}

	/** The Developer Tools container developer mode adds to the exercise page must stay out of the frame. */
	async function assertDeveloperToolsOutOfFrame(): Promise<void> {
		await artemisFrame();
		const visible = await driver.executeScript<boolean>(`
			const heading = [...document.querySelectorAll('h3')].find(h => h.textContent.trim() === 'Developer Tools');
			return !!heading && heading.getBoundingClientRect().top < window.innerHeight;
		`);
		if (visible) {
			throw new Error('The Developer Tools container is in the frame');
		}
	}

	before(async function () {
		this.timeout(180000);
		({ username, password } = getCredentials());
		const baseUrl = process.env.ARTEMIS_URL ?? 'https://artemis.tum.de';
		// The run deletes a participation and changes an account, so it only ever runs against
		// the local demo fixture, never against a real server.
		if (!['localhost', '127.0.0.1'].includes(new URL(baseUrl).hostname)) {
			throw new Error(`The screencast runs against a local Artemis only, not ${baseUrl}`);
		}
		const adminUser = process.env.ARTEMIS_ADMIN_USER;
		const adminPassword = process.env.ARTEMIS_ADMIN_PASSWORD;
		if (!adminUser || !adminPassword) {
			throw new Error('Set ARTEMIS_ADMIN_USER and ARTEMIS_ADMIN_PASSWORD; the preflight resets the participation as admin');
		}

		// Preflight: the run leaves a started exercise and an AI choice behind, so every run
		// starts by putting both back.
		student = new ArtemisClient(baseUrl);
		admin = new ArtemisClient(baseUrl);
		await student.login(username, password);
		await admin.login(adminUser, adminPassword);
		const courses = await student.request<{ id: number; title: string }[]>('GET', '/api/course/courses/for-dropdown');
		const course = courses.find(c => c.title === COURSE_TITLE);
		if (!course) {
			throw new Error(`${username} is not enrolled in "${COURSE_TITLE}"`);
		}
		courseId = course.id;
		const overview = await student.request<{ exercises: { id: number; title: string }[] }>('GET', `/api/course/courses/${courseId}/exercises-for-overview`);
		const exercise = overview.exercises.find(e => e.title === EXERCISE_TITLE);
		if (!exercise) {
			throw new Error(`No exercise "${EXERCISE_TITLE}" in "${COURSE_TITLE}"`);
		}
		exerciseId = exercise.id;
		const existing = await participationId();
		if (existing !== undefined) {
			await admin.request('DELETE', `/api/exercise/participations/${existing}`);
			const deadline = Date.now() + 60000;
			while (await participationId() !== undefined) {
				if (Date.now() > deadline) {
					throw new Error('The old participation was not deleted');
				}
				await new Promise(resolve => setTimeout(resolve, 1000));
			}
		}
		// Artemis cannot clear an AI choice, so "No AI" is the state the banner scene starts from.
		await student.request('PUT', '/api/account/users/select-llm-usage', { selection: 'NO_AI' });
		// Iris history belongs to the user, not the participation, so earlier runs would show up in scene 11.
		await student.request('DELETE', '/api/iris/chat/sessions');
		if (fs.existsSync(CLONE_ROOT)) {
			if (fs.lstatSync(CLONE_ROOT).isSymbolicLink() || fs.realpathSync(CLONE_ROOT) !== CLONE_ROOT) {
				throw new Error(`${CLONE_ROOT} is a link; refusing to empty it`);
			}
			fs.rmSync(CLONE_ROOT, { recursive: true, force: true });
		}
		fs.mkdirSync(CLONE_ROOT, { recursive: true });
		fs.mkdirSync(OUT_DIR, { recursive: true });

		driver = VSBrowser.instance.driver;
		await VSBrowser.instance.waitForWorkbench();
		if (await new ActivityBar().getViewControl('Artemis')) {
			throw new Error('The extension is already installed; the run must start from a profile without it');
		}
		await new EditorView().closeAllEditors().catch(() => undefined);
		await ensureFullscreen();
		await injectPointer();

		if (RECORD) {
			pointerTool = path.join(os.tmpdir(), 'artemis-screencast-pointer');
			execFileSync('swiftc', ['-O', path.join(PACKAGE_ROOT, 'test', 'e2e', 'ui', 'pointer.swift'), '-o', pointerTool], { stdio: 'inherit' });
			await parkSystemPointer();
			const [width, height] = await driver.executeScript<number[]>('return [Math.round(screen.width * devicePixelRatio), Math.round(screen.height * devicePixelRatio)]');
			const display = findCaptureDisplay(width, height);
			const raw = path.join(OUT_DIR, 'raw.mp4');
			recorder = spawn('ffmpeg', [
				'-hide_banner', '-loglevel', 'error', '-y',
				'-f', 'avfoundation', '-capture_cursor', '0', '-framerate', '30', '-i', `Capture screen ${display}:none`,
				'-c:v', 'h264_videotoolbox', '-b:v', '30M', '-pix_fmt', 'yuv420p',
				'-progress', 'pipe:1', raw,
			], { stdio: ['pipe', 'pipe', 'inherit'] });
			const pid = recorder.pid;
			process.on('exit', () => { if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } } });
			// The recording's time zero is when its first frame was taken, read back from ffmpeg's
			// progress report, so the timeline lines up with the video.
			recordingStart = await new Promise<number>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error('ffmpeg reported no progress')), 30000);
				let buffer = '';
				recorder!.stdout!.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const match = /out_time_us=(\d+)/.exec(buffer);
					if (match && Number(match[1]) > 0) {
						clearTimeout(timer);
						resolve(Date.now() - Number(match[1]) / 1000);
					}
				});
				recorder!.on('exit', code => reject(new Error(`ffmpeg exited with ${code}`)));
			});
			recorder.stdout!.resume();
		} else {
			recordingStart = Date.now();
		}
	});

	after(async function () {
		this.timeout(60000);
		if (recorder && recorder.exitCode === null) {
			const exited = new Promise(resolve => recorder!.once('exit', resolve));
			recorder.stdin!.write('q');
			await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 20000))]);
			if (recorder.exitCode === null) {
				recorder.kill('SIGKILL');
			}
		}
		fs.writeFileSync(path.join(OUT_DIR, 'timeline.json'), JSON.stringify({ recorded: RECORD, scenes, cuts }, null, 2));
	});

	scene(1, 'Intro',
		'This video shows the Artemis extension for VS Code. With it, you work on your programming exercises and ask Iris without leaving the editor.',
		60000, async () => {
			await say(0);
			await driver.sleep(1000);
			await say(1);
		});

	scene(2, 'Install',
		'Open the Extensions view, search for Artemis - TUM and install it. VS Code asks once whether you trust the publisher; confirm it. A new Artemis icon appears on the left. VS Code also opens a short walkthrough. It covers the same steps as this video, so we close it.',
		240000, async () => {
			await say(0);
			await openFromActivityBar('Extensions');
			// The search field's input element is hidden behind the editor widget, so the widget is
			// what gets clicked and the keys go to whatever holds the focus then.
			const search = await driver.wait(async () => (await driver.findElements(By.css('.extensions-viewlet .suggest-input-container')))[0] ?? null, 20000, 'No extension search field') as WebElement;
			await pointWorkbench(search);
			await typeIntoFocus(EXTENSION_NAME);
			// The result list re-renders while the Marketplace answers, so a row can go stale mid-lookup;
			// the lookup then simply runs again.
			const findInstall = async (): Promise<WebElement | null> => {
				for (const candidate of await driver.findElements(By.css('.extensions-list .monaco-list-row'))) {
					const name = await candidate.findElements(By.css('.name'));
					if (name.length > 0 && (await name[0].getText()).trim() === EXTENSION_NAME) {
						return (await candidate.findElements(By.xpath(".//a[contains(@class, 'install') and not(contains(@class, 'disabled'))] | .//*[contains(@class, 'extension-action') and normalize-space(.)='Install']")))[0] ?? null;
					}
				}
				return null;
			};
			const settled = async (): Promise<WebElement | null> => findInstall().catch(error => {
				if (error instanceof Error && error.name === 'StaleElementReferenceError') {
					return null;
				}
				throw error;
			});
			await driver.wait(settled, 60000, `"${EXTENSION_NAME}" not found in the Marketplace`);
			await driver.sleep(800);
			const install = await driver.wait(settled, 10000, `"${EXTENSION_NAME}" has no Install button`) as WebElement;
			await pointWorkbench(install);
			// A fresh profile asks whether to trust the publisher (custom dialog style, so it is DOM).
			const trust = await driver.wait(async () => (await driver.findElements(By.xpath("//div[contains(@class, 'monaco-dialog-box')]//a[contains(@class, 'monaco-button')][contains(normalize-space(.), 'Trust')]")))[0] ?? null, 30000, 'No publisher trust dialog') as WebElement;
			await say(1);
			await driver.sleep(1200);
			await pointWorkbench(trust);
			await driver.wait(async () => (await new ActivityBar().getViewControl('Artemis')) !== undefined, 120000, 'The Artemis view never appeared');
			await say(2);
			// The video has to show the release this checkout describes, not an older Marketplace build.
			const extensionsDir = path.resolve(PACKAGE_ROOT, process.env.UI_EXTENSIONS_DIR ?? '');
			const expected = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')).version as string;
			const installed = fs.readdirSync(extensionsDir).filter(name => name.startsWith(`${EXTENSION_ID}-`));
			if (!installed.includes(`${EXTENSION_ID}-${expected}`)) {
				throw new Error(`The Marketplace installed ${installed.join(', ') || 'nothing'}, expected ${EXTENSION_ID}-${expected}`);
			}
			// The walkthrough opens on install; it is shown briefly, then closed.
			await driver.wait(async () => (await driver.findElements(By.css('.gettingStartedContainer'))).length > 0, 30000, 'The walkthrough did not open').catch(() => undefined);
			await say(3);
			await driver.sleep(2500);
			await say(4);
			const close = await driver.findElements(By.css('.tabs-container .tab.active .codicon-close'));
			if (close.length > 0) {
				await pointWorkbench(close[0]);
			}
			await new EditorView().closeAllEditors().catch(() => undefined);
			await settle();
			// Off camera: the login page names the local demo server until the blur is in place.
			// The stylesheet blurs that line through the re-renders of the two login steps.
			await offCamera(async () => {
				await openFromActivityBar('Artemis');
				await setSidebarWidth(driver, SIDEBAR_WIDTH);
				await artemisFrame();
				await waitForElement(driver, '#username', 30000);
				await driver.executeScript(`
					const style = document.createElement('style');
					style.textContent = '[data-testid="login-server"] { filter: blur(6px); }';
					document.head.appendChild(style);
				`);
				await driver.sleep(500);
				await switchBackFromWebview(driver);
			});
		});

	scene(3, 'Sign in',
		'Enter your username and select Continue. Depending on your account, you then enter your password, or you sign in through your university\'s login page in the browser. After that, you see the dashboard.',
		120000, async () => {
			await artemisFrame();
			await say(0);
			const usernameInput = await waitForElement(driver, '#username', 30000);
			await pointWebview(usernameInput);
			await typeSlowly(usernameInput, username, 70);
			await pointWebview(await waitForElement(driver, '[data-testid="login-next"]'));
			const passwordInput = await waitForElement(driver, '#password', 15000);
			await say(1);
			await pointWebview(passwordInput);
			await typeSlowly(passwordInput, password.slice(0, 12), 60);
			await passwordInput.sendKeys(password.slice(12));
			await hoverText('Remember me');
			await pointWebview(await waitForElement(driver, '[data-testid="login-submit"]'));
			await driver.sleep(3000);
			await reattachWebviewFrame(driver);
			await waitForPage('Browse Courses', 30000);
			await say(2);
		});

	scene(4, 'Dashboard and courses',
		'The dashboard shows the exercise open in your workspace. No exercise is open yet, so Choose takes you to your courses. Below are your recent courses, and tools and settings. Browse Courses lists every course you are enrolled in, and you can search and filter it. Select a course to see its exercises with their due dates and points.',
		120000, async () => {
			await artemisFrame();
			await say(0);
			await hoverText('Current Workspace Exercise');
			await say(1);
			await hoverText('Choose', 1500);
			await say(2);
			await hoverText('Recent Courses');
			await hoverText(COURSE_TITLE);
			await hoverText('Tools & Settings');
			await say(3);
			await clickText('Browse Courses', true);
			const search = await waitForElement(driver, 'input[placeholder^="Search courses"]', 15000);
			await pointWebview(search);
			await typeSlowly(search, 'Software');
			await driver.sleep(1200);
			await search.sendKeys(Key.chord(Key.META, 'a'), Key.BACK_SPACE);
			await driver.sleep(600);
			await say(4);
			const row = await driver.findElement(By.xpath(`//*[starts-with(@data-testid, 'course-entry-')][contains(., ${xpathLiteral(COURSE_TITLE)})]`));
			await pointWebview(row);
			await reattachWebviewFrame(driver);
			await waitForPage(EXERCISE_TITLE, 15000);
			await hoverText(EXERCISE_TITLE, 1200);
		});

	scene(5, 'Start and clone',
		'An exercise you have not started has a Start Exercise button. It creates your repository in Artemis, just like in the browser. Then select Clone Repository. The first time, the extension asks where your exercise repositories should go. After cloning, open the repository as your workspace. The extension only submits from the repository that is open.',
		300000, async () => {
			await artemisFrame();
			await clickText(EXERCISE_TITLE, true);
			await waitForPage('Not Participating Yet', 15000);
			await say(0);
			await say(1);
			await clickText('Start Exercise');
			await waitForPage('Repository Ready', 60000);
			await driver.sleep(800);
			await say(2);
			const clone = await driver.findElement(By.xpath("//button[normalize-space(.)='Clone Repository']"));
			await pointWebview(clone);
			await switchBackFromWebview(driver);
			const setDefault = await driver.wait(async () => (await driver.findElements(By.xpath("//div[contains(@class, 'monaco-dialog-box')]//a[contains(@class, 'monaco-button')][normalize-space(.)='Set Default Folder']")))[0] ?? null, 20000, 'No clone folder dialog') as WebElement;
			await say(3);
			await driver.sleep(2500);
			await pointWorkbench(setDefault);
			// The simple file dialog opens on files.dialog.defaultPath, the demo clone folder.
			const accept = await driver.wait(async () => (await driver.findElements(By.xpath("//div[contains(@class, 'quick-input-widget')]//a[contains(@class, 'monaco-button')][normalize-space(.)='Set as Default'] | //div[contains(@class, 'quick-input-widget')]//*[contains(@class, 'monaco-button')][contains(normalize-space(.), 'Set as Default')]")))[0] ?? null, 20000, 'No folder picker') as WebElement;
			await driver.sleep(1500);
			await pointWorkbench(accept);
			const handlesBefore = await driver.getAllWindowHandles();
			const openFolder = await driver.wait(async () => (await driver.findElements(By.xpath("//div[contains(@class, 'notification-toast')]//a[contains(@class, 'monaco-button')][normalize-space(.)='Open Folder']")))[0] ?? null, 120000, 'The clone never offered Open Folder') as WebElement;
			await say(4);
			await driver.sleep(1200);
			await pointWorkbench(openFolder, false);
			// VS Code opens a new window on the display under the system pointer, so for this one click
			// the system pointer sits under the drawn one.
			const target = await workbenchCentre(openFolder);
			await systemPointer('to', target.x, target.y);
			await pointWorkbench(openFolder);
			// Open Folder forces a new window. The driver follows it; the old, empty window stays
			// behind the new fullscreen one.
			await offCamera(async () => {
				const handle = await driver.wait(async () => (await driver.getAllWindowHandles()).find(h => !handlesBefore.includes(h)) ?? null, 60000, 'No new window') as string;
				await driver.switchTo().window(handle);
				await VSBrowser.instance.waitForWorkbench();
				await driver.wait(async () => (await new ActivityBar().getViewControl('Artemis')) !== undefined, 60000, 'Artemis did not activate in the new window');
				await new EditorView().closeAllEditors().catch(() => undefined);
				await ensureFullscreen();
				await parkSystemPointer();
				await injectPointer();
				await artemisFrame();
				await switchBackFromWebview(driver);
				await setSidebarWidth(driver, SIDEBAR_WIDTH);
				await artemisFrame();
				await waitForPage(EXERCISE_TITLE, 60000);
				await switchBackFromWebview(driver);
				await driver.sleep(1000);
			});
			repo = findRepo();
			await say(5);
			await artemisFrame();
			await hoverText('Current Workspace Exercise');
			await clickText(EXERCISE_TITLE, true);
			await waitForPage('Repository Ready', 30000);
		});

	scene(6, 'Submit and test results',
		'Make a change and save it. The exercise page shows that there is something to submit. Submit commits your changes and pushes them to Artemis, without any Git commands. Artemis builds and tests your code, and the result appears right here. See test results lists every test, failed ones first, with their feedback. In the problem statement, select a task to see only its tests.',
		600000, async () => {
			let editor!: TextEditor;
			await offCamera(async () => {
				editor = await openFile(BUBBLE_SORT);
				await driver.sleep(800);
			});
			await say(0);
			await caretToLineEnd('TODO:');
			// Home stops at the indentation first, so twice selects the whole line.
			await editor.typeText(Key.chord(Key.SHIFT, Key.HOME));
			await editor.typeText(Key.chord(Key.SHIFT, Key.HOME));
			await driver.sleep(400);
			for (const [index, line] of BUBBLE_SORT_BODY.entries()) {
				await typeInEditor(editor, line);
				if (index < BUBBLE_SORT_BODY.length - 1) {
					await editor.typeText(Key.ENTER);
				}
			}
			await driver.sleep(500);
			await editor.save();
			await artemisFrame();
			await waitForPage('Uncommitted changes ready to submit', 30000);
			await say(1);
			await hoverText('Uncommitted changes ready to submit');
			await say(2);
			await submitAndWait('See test results');
			await say(3);
			await hoverText('tests', 1500);
			await say(4);
			await clickText('See test results');
			await driver.sleep(1500);
			await driver.executeScript(`
				const list = [...document.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 40 && getComputedStyle(el).overflowY !== 'visible' && el.textContent.includes('Passed'));
				if (list) { list.scrollBy({ top: 260, behavior: 'smooth' }); }
			`);
			await driver.sleep(2000);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
			await driver.sleep(800);
			await say(5);
			// The problem statement makes a task clickable only once it has tests (ProblemStatement.tsx).
			const task = await waitForElement(driver, '.artemis-task[data-test-ids]', 15000);
			await pointWebview(task);
			await driver.sleep(2500);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
		});

	scene(7, 'When the build fails',
		'If your code does not compile, there are no test results, only Build failed. Go to source opens the file at the first error, and the error is marked right above its line. Open log shows the full build log.',
		600000, async () => {
			const editor = await openFile(BUBBLE_SORT);
			await say(0);
			await caretToLineEnd('temp)');
			await driver.sleep(400);
			await editor.typeText(Key.BACK_SPACE);
			await driver.sleep(800);
			await editor.save();
			await artemisFrame();
			await submitAndWait('Go to source');
			await hoverText('Build failed', 1200);
			await say(1);
			await clickText('Go to source');
			await switchBackFromWebview(driver);
			await driver.wait(async () => (await driver.findElements(By.css('.codelens-decoration'))).length > 0, 30000, 'No CodeLens on the failing line');
			await pointWorkbench(await driver.findElement(By.css('.codelens-decoration')), false);
			await driver.sleep(2500);
			await artemisFrame();
			await say(2);
			await clickText('Open log');
			await switchBackFromWebview(driver);
			await driver.sleep(3500);
			await settle();
			// The log is an untitled document, so a plain close would ask whether to save it.
			await offCamera(() => new Workbench().executeCommand('View: Revert and Close Editor'));
			// Back to compiling code; not submitted again, the next scenes do not need it.
			const fixed = await openFile(BUBBLE_SORT);
			await caretToLineEnd('temp)');
			await fixed.typeText(';');
			await fixed.save();
			await driver.sleep(800);
		});

	scene(8, 'More and Pull Changes',
		'Under More you find the actions you need less often. Pull Changes brings in changes you made elsewhere, for example in the online code editor of Artemis.',
		600000, async () => {
			await offCamera(async () => {
				const participation = await participationId();
				if (participation === undefined) {
					throw new Error('No participation for the online edit');
				}
				const resultBefore = await latestResultId(participation);
				await student.request('PUT', `/api/programming/repository/${participation}/files?commit=true`, [
					{ fileName: MERGE_SORT.split(path.sep).join('/'), fileContent: MERGE_SORT_ONLINE_EDIT },
				]);
				// The commit triggers a build; it finishes here, not on camera.
				const deadline = Date.now() + 240000;
				while (await latestResultId(participation) === resultBefore) {
					if (Date.now() > deadline) {
						throw new Error('The build of the online edit never finished');
					}
					await new Promise(resolve => setTimeout(resolve, 2000));
				}
				await openFile(MERGE_SORT);
				await artemisFrame();
				await driver.sleep(3000);
				await switchBackFromWebview(driver);
			});
			await driver.sleep(1200);
			await artemisFrame();
			await say(0);
			await clickText('More ▾');
			await driver.sleep(500);
			await hoverText('Check workspace status', 600);
			await hoverText('Copy Clone URL', 600);
			await say(1);
			await clickText('Pull Changes');
			await switchBackFromWebview(driver);
			// The DOM, not TextEditor.getText(): that one selects all through the command palette.
			await driver.wait(async () => (await driver.findElements(By.xpath("//div[contains(@class, 'view-lines')]/div[contains(@class, 'view-line')][contains(., 'halves')]"))).length > 0, 30000, 'Pull Changes did not bring the online edit');
			// Through the DOM, not the TextEditor API: focus is still in the Artemis view after the
			// click, and the editor API needs it. One word only: Monaco renders spaces as &nbsp;.
			await pointWorkbench(await driver.findElement(By.xpath("//div[contains(@class, 'view-lines')]/div[contains(@class, 'view-line')][contains(., 'halves')]")), false);
			await driver.sleep(1500);
		});

	scene(9, 'Submission Setup',
		'If submitting does not work, open Submission Setup on the dashboard. It checks Git, your name and email, the repository and your access to it, and fixes what it can.',
		120000, async () => {
			await artemisFrame();
			await backToDashboard();
			await say(0);
			await clickText('Submission Setup', true);
			await waitForPage('Git installed', 30000);
			await say(1);
			await driver.sleep(2000);
			for (const row of await driver.findElements(By.css('[data-testid^="setup-row-"]'))) {
				await pointWebview(row, false);
				await driver.sleep(500);
			}
		});

	scene(10, 'Iris needs your AI choice',
		'Iris only answers once you have chosen in Artemis to use AI. If you have not, or chose not to, the chat says so. Open Artemis settings takes you to the page where you choose. Once you have chosen to use AI there, select Retry.',
		180000, async () => {
			await say(0);
			await openFromActivityBar('Iris Chat');
			await irisFrame();
			await waitForPage('Open Artemis settings', 60000);
			await say(1);
			await driver.sleep(1500);
			await say(2);
			await hoverText('Open Artemis settings', 2500);
			await offCamera(async () => {
				await student.request('PUT', '/api/account/users/select-llm-usage', { selection: 'CLOUD_AI' });
				await driver.sleep(500);
			});
			await say(3);
			await clickText('Retry');
			await waitForElement(driver, '[aria-label="Chat input"]', 60000);
			await driver.sleep(1500);
		});

	scene(11, 'Asking Iris',
		'Ask on the Ask Iris card opens the chat with this exercise as its topic. It is the same Iris as in Artemis, with the same rules. While it works, you see what it reads. In VS Code, Iris also sees code you have not submitted yet, and the line above the message box shows which files it got. The chip above the message box is the topic. Use the plus to switch to another exercise or to the whole course. The clock icon lists your earlier conversations, and you can continue them in Artemis too.',
		600000, async () => {
			await openFromActivityBar('Artemis');
			await artemisFrame();
			await backToDashboard();
			await clickText(EXERCISE_TITLE, true);
			await waitForPage('Ask Iris', 30000);
			await say(0);
			const ask = await driver.findElement(By.xpath("//button[normalize-space(.)='Ask']"));
			await pointWebview(ask);
			await switchBackFromWebview(driver);
			await irisFrame();
			const input = await waitForElement(driver, '[aria-label="Chat input"]', 30000);
			await waitUntilIrisIdle(driver, 60000);
			await say(1);
			await pointWebview(input);
			await typeSlowly(input, IRIS_QUESTION);
			await pointWebview(await waitForElement(driver, '[aria-label="Send message"]'));
			await driver.wait(async () => (await driver.findElements(By.css('[data-testid="message-row"]'))).length >= 2, 60000, 'Iris never started answering');
			await say(2);
			await driver.sleep(4000);
			await offCamera(() => waitUntilIrisIdle(driver, 300000));
			const rows = await driver.findElements(By.css('[data-testid="message-row"]'));
			await driver.executeScript(`
				let el = arguments[0].parentElement;
				while (el && el.scrollHeight <= el.clientHeight) { el = el.parentElement; }
				if (el) { el.scrollTop = 0; }
			`, rows[0]);
			await driver.sleep(1500);
			await driver.executeScript(`
				let el = arguments[0].parentElement;
				while (el && el.scrollHeight <= el.clientHeight) { el = el.parentElement; }
				if (el) { el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }
			`, rows[0]);
			await driver.sleep(3000);
			const helpful = await driver.findElements(By.css('[aria-label="Helpful"]'));
			if (helpful.length > 0) {
				await pointWebview(helpful[helpful.length - 1]);
				await driver.sleep(800);
			}
			await say(3);
			const referenced = await driver.findElements(By.xpath("//*[self::button or @role='button'][contains(normalize-space(.), 'referenced')]"));
			if (referenced.length > 0) {
				await pointWebview(referenced[referenced.length - 1]);
				await driver.sleep(2500);
				await pointWebview(referenced[referenced.length - 1]);
			} else {
				console.log('No "referenced" line above the message box');
			}
			await say(4);
			await say(5);
			await pointWebview(await waitForElement(driver, '[title="Change topic"]'));
			await waitForElement(driver, '[data-testid^="picker-entry-"]');
			await driver.sleep(1200);
			await hoverText('Course chat', 1000);
			await hoverText('Workspace', 1200);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
			await driver.sleep(600);
			await say(6);
			await pointWebview(await waitForElement(driver, '[aria-label="View past conversations"]'));
			await driver.sleep(2500);
			await driver.actions().sendKeys(Key.ESCAPE).perform();
			await driver.sleep(600);
		});

	scene(12, 'Proactive help',
		'Iris can also offer help on its own when you seem stuck. This needs your consent first: select Enable in Settings and set it to enabled. The extension then observes on your computer how you work, for example how fast you type and how long you pause, and sends your code to Iris only when you might be stuck. On the Ask Iris card you choose how much Iris steps in. Off means Iris only helps when you ask. With More, a banner offers a hint, and Show me opens it in the chat. A hint about a line also appears right next to it. With Less there is no banner, only a quiet mark in the status bar and the margin.',
		900000, async () => {
			await returnToExercisePage();
			await say(0);
			await say(1);
			await clickText('Enable in Settings');
			await switchBackFromWebview(driver);
			const settings = new SettingsEditor();
			const consent = await driver.wait(async () => (await settings.findSettingByID('artemis.iris.proactiveCodeEgress').catch(() => undefined)) ?? null, 30000, 'The consent setting did not open');
			const select = await consent!.findElement(By.css('select'));
			await pointWorkbench(select, false);
			await consent!.setValue('enabled');
			await say(2);
			await driver.sleep(1500);
			await new EditorView().closeAllEditors();
			await artemisFrame();
			await say(3);
			const card = await findByText('Proactive help');
			await pointWebview(card, false);
			await say(4);
			await hoverText('Off', 800);
			await hoverText('Less', 800);
			await clickText('More');
			await driver.sleep(1000);

			// Developer mode stays on until the end of the scene: switching it re-renders the
			// Artemis view, which would drop the banner.
			let mocked = false;
			await offCamera(async () => {
				await switchBackFromWebview(driver);
				await setDeveloperMode(true);
				await artemisFrame();
				await waitForPage('Proactive help', 30000);
				await switchBackFromWebview(driver);
				await openFile(BUBBLE_SORT);
				await caretToLineEnd('j++)');
				await interventionMenu('Force struggle intervention');
				await artemisFrame();
				// Iris decides within seconds (about 10 s against the local Pyris).
				const banner = await driver.wait(async () => (await driver.findElements(By.xpath("//button[normalize-space(.)='Show me']")))[0] ?? null, 45000).catch(() => null);
				if (!banner) {
					// Iris may decide to stay silent; the visual mock shows the same surfaces.
					console.log('No hint from Iris; falling back to the visual mock');
					mocked = true;
					await switchBackFromWebview(driver);
					await openFile(BUBBLE_SORT);
					await caretToLineEnd('j++)');
					await interventionMenu('Mock active proactivity');
					await artemisFrame();
					await driver.wait(async () => (await driver.findElements(By.xpath("//button[normalize-space(.)='Show me']"))).length > 0, 20000, 'The mock banner never appeared');
				}
				await assertDeveloperToolsOutOfFrame();
			});
			await driver.sleep(800);
			await say(5);
			await hoverText('Show me', 1200);
			if (!mocked) {
				await clickText('Show me');
				await switchBackFromWebview(driver);
				await irisFrame();
				await waitForPage('Iris reached out', 30000);
				await driver.sleep(3000);
				await returnToExercisePage();
			}
			await switchBackFromWebview(driver);
			await driver.wait(async () => (await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr'))).length > 0, 30000, 'No Iris hint in the editor').catch(() => console.log('No inline hint in the editor'));
			await say(6);
			const hint = await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr'));
			if (hint.length > 0) {
				await pointWorkbench(hint[0], false);
			}
			await driver.sleep(3000);

			await offCamera(async () => {
				await interventionMenu('Clear mocked surfaces');
				await driver.sleep(1000);
			});
			await artemisFrame();
			await say(7);
			await clickText('Less');
			await driver.sleep(800);
			await offCamera(async () => {
				await switchBackFromWebview(driver);
				await openFile(BUBBLE_SORT);
				await caretToLineEnd('j++)');
				await interventionMenu('Mock ambient proactivity');
				await driver.wait(async () => (await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr'))).length > 0, 20000, 'No Iris mark in the margin');
				await assertDeveloperToolsOutOfFrame();
				await switchBackFromWebview(driver);
			});
			const lamp = await driver.findElements(By.xpath("//*[contains(@class, 'statusbar-item')][contains(normalize-space(.), 'Iris has a hint')]"));
			if (lamp.length > 0) {
				await pointWorkbench(lamp[0], false);
				await driver.sleep(1800);
			}
			await pointWorkbench((await driver.findElements(By.css('#workbench\\.parts\\.editor .cgmr')))[0], false);
			await driver.sleep(2000);
		});

	scene(13, 'Settings and outro',
		'Open Settings shows every setting of the extension. If something does not work, Bug Report opens our issue tracker. The full guide is in the Artemis documentation. Have fun with your exercises.',
		180000, async () => {
			// Scene 12's hint stays on screen through that scene's hold, so it is cleared here.
			await offCamera(async () => {
				await switchBackFromWebview(driver);
				await interventionMenu('Clear mocked surfaces');
				await setDeveloperMode(false);
				await new EditorView().closeAllEditors();
			});
			await artemisFrame();
			await backToDashboard();
			await say(0);
			await clickText('Open Settings');
			await switchBackFromWebview(driver);
			await driver.sleep(2500);
			await driver.executeScript(`
				const tree = document.querySelector('.settings-editor .settings-tree-container .monaco-scrollable-element');
				if (tree) { tree.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, bubbles: true })); }
			`);
			await driver.sleep(2000);
			await new EditorView().closeAllEditors();
			await artemisFrame();
			await say(1);
			await hoverText('Bug Report', 2500);
			await say(2);
			await say(3);
		});
});
