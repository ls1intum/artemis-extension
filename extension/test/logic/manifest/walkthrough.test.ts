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

    it('gives the server step both completion events, so confirming the default still completes it', () => {
        const chooseServer = steps.find(s => s.id === 'chooseServer');
        expect(chooseServer?.completionEvents).toEqual([
            'onCommand:artemis.setServerUrl',
            'onSettingChanged:artemis.serverUrl',
        ]);
    });

    it('only links commands that exist: contributed, an allowed built-in, or a generated view focus', () => {
        for (const step of steps) {
            for (const [, command] of step.description.matchAll(COMMAND_LINK_RE)) {
                const isViewFocus = command.endsWith('.focus')
                    && contributedViewIds.has(command.slice(0, -'.focus'.length));
                expect(
                    contributedCommands.has(command) || ALLOWED_BUILTIN_COMMANDS.has(command) || isViewFocus,
                    `step "${step.id}" links unknown command "${command}"`,
                ).toBe(true);
            }
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
