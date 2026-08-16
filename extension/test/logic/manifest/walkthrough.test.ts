import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const EXTENSION_ROOT = join(__dirname, '../../..');

type Media = { image?: string; markdown?: string; svg?: string; altText?: string };
type Step = { id: string; title: string; description: string; media?: Media; when?: string; completionEvents?: string[] };
type Walkthrough = { id: string; title: string; description: string; steps: Step[] };

const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
    contributes: {
        commands: { command: string }[];
        configuration: { properties: Record<string, unknown> };
        views: Record<string, { id: string; type?: string }[]>;
        walkthroughs?: Walkthrough[];
    };
};

/** VS Code built-ins the walkthrough is allowed to link. Keep this list tiny and explicit. */
const ALLOWED_BUILTIN_COMMANDS = new Set(['workbench.action.openSettings']);

/** Matches `[label](command:some.command)` and `[label](command:some.command?%5B...%5D)`. */
const COMMAND_LINK_RE = /\(command:([^)?\s]+)/g;

const walkthroughs = manifest.contributes.walkthroughs ?? [];
const steps = walkthroughs.flatMap(w => w.steps);
const contributedCommands = new Set(manifest.contributes.commands.map(c => c.command));
const contributedViewIds = new Set(Object.values(manifest.contributes.views).flat().map(v => v.id));
const contributedSettingKeys = new Set(Object.keys(manifest.contributes.configuration.properties));

/** A command a completion event or a description link may reference: contributed, an allowed
 * built-in, or a generated view-focus command. Shared so the two callers cannot drift apart. */
function isKnownCommand(command: string): boolean {
    const isViewFocus = command.endsWith('.focus')
        && contributedViewIds.has(command.slice(0, -'.focus'.length));
    return contributedCommands.has(command) || ALLOWED_BUILTIN_COMMANDS.has(command) || isViewFocus;
}

describe('contributes.walkthroughs', () => {
    it('contributes exactly the artemisGetStarted walkthrough', () => {
        expect(walkthroughs.map(w => w.id)).toEqual(['artemisGetStarted']);
    });

    it('has the five designed steps in order', () => {
        expect(steps.map(s => s.id)).toEqual([
            'chooseServer', 'signIn', 'exerciseFolder', 'meetIris', 'preferences',
        ]);
    });

    it('gates the Iris step on the same context key its view is gated on', () => {
        const meetIris = steps.find(s => s.id === 'meetIris');
        expect(meetIris?.when).toBe('iris:authenticated == true');
    });

    it('only links commands that exist: contributed, an allowed built-in, or a generated view focus', () => {
        for (const step of steps) {
            for (const [, command] of step.description.matchAll(COMMAND_LINK_RE)) {
                expect(isKnownCommand(command), `step "${step.id}" links unknown command "${command}"`).toBe(true);
            }
        }
    });

    it('gives every step at least one command link, so there is always something to act on', () => {
        for (const step of steps) {
            const commands = [...step.description.matchAll(COMMAND_LINK_RE)];
            expect(commands.length, `step "${step.id}" description has no command link`).toBeGreaterThan(0);
        }
    });

    it('references only media files that exist inside the packaged media directory', () => {
        const mediaRoot = join(EXTENSION_ROOT, 'media');
        for (const step of steps) {
            const paths = [step.media?.image, step.media?.markdown, step.media?.svg].filter(Boolean) as string[];
            expect(paths.length, `step "${step.id}" has no media`).toBe(1);
            for (const p of paths) {
                const resolved = resolve(EXTENSION_ROOT, p);
                // `media/` is the only directory the packaging scripts copy wholesale, so a
                // path outside it resolves in the checkout and 404s in the shipped VSIX.
                expect(
                    resolved.startsWith(mediaRoot + sep),
                    `step "${step.id}" media escapes extension/media: ${p}`,
                ).toBe(true);
                expect(existsSync(resolved), `step "${step.id}" media missing: ${p}`).toBe(true);
            }
        }
    });

    it('gives every image media an altText', () => {
        for (const step of steps) {
            if (step.media?.image) {
                expect(step.media.altText, `step "${step.id}" image has no altText`).toBeTruthy();
            }
        }
    });

    it('keeps command links out of step markdown media, which the manifest scanner cannot see', () => {
        for (const step of steps) {
            if (!step.media?.markdown) { continue; }
            const body = readFileSync(join(EXTENSION_ROOT, step.media.markdown), 'utf8');
            expect(body).not.toMatch(/\(command:/);
        }
    });
});

// Each of these pins one step's completionEvents to its exact expected value, then decodes
// that value and checks it against the real thing it names. A rename or typo on either side
// fails the relevant test instead of leaving the step permanently uncompletable.
describe('completion events', () => {
    const stepById = new Map(steps.map(s => [s.id, s]));

    it('gives the server step both completion events, so confirming the default still completes it', () => {
        const step = stepById.get('chooseServer');
        expect(step?.completionEvents).toEqual([
            'onCommand:artemis.setServerUrl',
            'onSettingChanged:artemis.serverUrl',
        ]);
        const [commandEvent, settingEvent] = step!.completionEvents!;
        const commandId = commandEvent.slice('onCommand:'.length);
        expect(isKnownCommand(commandId), `onCommand names unknown command "${commandId}"`).toBe(true);
        const settingKey = settingEvent.slice('onSettingChanged:'.length);
        expect(contributedSettingKeys.has(settingKey), `onSettingChanged names unknown setting "${settingKey}"`).toBe(true);
    });

    it('completes the sign-in step on the context key the extension actually sets on login', () => {
        // Set by `vscode.commands.executeCommand('setContext', 'iris:authenticated', ...)`
        // in `src/extension.ts` (auth-state-change handler and startup auth check).
        const IRIS_AUTHENTICATED_CONTEXT_KEY = 'iris:authenticated';
        const step = stepById.get('signIn');
        expect(step?.completionEvents).toEqual([`onContext:${IRIS_AUTHENTICATED_CONTEXT_KEY}`]);
    });

    it('completes the exercise-folder step on the clone-path setting it links to', () => {
        const step = stepById.get('exerciseFolder');
        expect(step?.completionEvents).toEqual(['onSettingChanged:artemis.defaultClonePath']);
        const settingKey = step!.completionEvents![0].slice('onSettingChanged:'.length);
        expect(contributedSettingKeys.has(settingKey), `onSettingChanged names unknown setting "${settingKey}"`).toBe(true);
    });

    it('completes the meet-Iris step when the chat view it links to actually opens', () => {
        const step = stepById.get('meetIris');
        expect(step?.completionEvents).toEqual(['onView:iris.chatView']);
        const viewId = step!.completionEvents![0].slice('onView:'.length);
        expect(contributedViewIds.has(viewId), `onView names unknown view "${viewId}"`).toBe(true);
    });

    it('leaves the preferences step without completion events, so it completes via its own description link', () => {
        // No `onView`/`onSettingChanged`/`onCommand` fits "opened the settings UI to the
        // Artemis section"; VS Code falls back to completing the step when the description's
        // own command link is clicked, which is the behaviour this step relies on.
        const step = stepById.get('preferences');
        expect(step).toBeDefined();
        expect('completionEvents' in step!).toBe(false);

        // Because this step has no completionEvents, the description's command link is its
        // only path to completion; a missing or malformed link leaves it permanently stuck.
        const commands = [...step!.description.matchAll(COMMAND_LINK_RE)].map(([, command]) => command);
        expect(commands.length, 'preferences step has no command link to complete on').toBeGreaterThan(0);
        for (const command of commands) {
            expect(isKnownCommand(command), `preferences step links unknown command "${command}"`).toBe(true);
        }
    });
});
