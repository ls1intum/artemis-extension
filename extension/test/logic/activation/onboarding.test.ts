import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    maybeOpenGetStartedWalkthrough,
    type OnboardingDeps,
    parseWalkthroughStep,
    type StartupAuthState,
    WALKTHROUGH_ID,
    WALKTHROUGH_STEPS,
    WalkthroughNavigator,
    type WalkthroughNavigatorDeps,
} from '@extension/activation/onboarding';

const EXTENSION_ROOT = join(__dirname, '../../..');

const CONTRIBUTED = [{ id: 'artemisGetStarted', steps: [] }];

let opened: string[];
let marked: number;

function deps(overrides: Partial<OnboardingDeps> = {}): OnboardingDeps {
    return {
        authState: 'no-credentials' as StartupAuthState,
        contributedWalkthroughs: CONTRIBUTED,
        extensionId: 'aet-tum.iris-thaumantias',
        isTheia: false,
        wasShown: () => false,
        markShown: async () => { marked += 1; },
        openWalkthrough: async (id: string) => { opened.push(id); },
        ...overrides,
    };
}

beforeEach(() => {
    opened = [];
    marked = 0;
});

describe('maybeOpenGetStartedWalkthrough', () => {
    it('opens the walkthrough on a fresh desktop install and records that it did', async () => {
        await maybeOpenGetStartedWalkthrough(deps());
        expect(opened).toEqual(['aet-tum.iris-thaumantias#artemisGetStarted']);
        expect(marked).toBe(1);
    });

    it('does nothing once it has already run', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ wasShown: () => true }));
        expect(opened).toEqual([]);
        expect(marked).toBe(0);
    });

    it('stays out of the way in Theia, and does not come back', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ isTheia: true }));
        expect(opened).toEqual([]);
        expect(marked).toBe(1);
    });

    it('skips a user who already has stored credentials, and does not come back', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ authState: 'has-credentials' }));
        expect(opened).toEqual([]);
        expect(marked).toBe(1);
    });

    it('never opens a walkthrough this build does not contribute, and stays retryable', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ contributedWalkthroughs: undefined }));
        expect(opened).toEqual([]);
        expect(marked).toBe(0);
    });

    it('ignores a manifest that contributes some other walkthrough', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ contributedWalkthroughs: [{ id: 'somethingElse' }] }));
        expect(opened).toEqual([]);
        expect(marked).toBe(0);
    });

    it('stays retryable when the startup auth read failed', async () => {
        await maybeOpenGetStartedWalkthrough(deps({ authState: 'unknown' }));
        expect(opened).toEqual([]);
        expect(marked).toBe(0);
    });

    it('records the run even if opening the walkthrough throws, so it cannot loop', async () => {
        const openWalkthrough = vi.fn(async () => { throw new Error('no such walkthrough'); });
        await expect(maybeOpenGetStartedWalkthrough(deps({ openWalkthrough }))).rejects.toThrow('no such walkthrough');
        expect(marked).toBe(1);
    });

    it('opens the id the real manifest actually contributes, not a copy that can drift from it', () => {
        const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
            contributes: { walkthroughs: { id: string }[] };
        };
        expect(manifest.contributes.walkthroughs).toHaveLength(1);
        expect(WALKTHROUGH_ID).toBe(manifest.contributes.walkthroughs[0].id);
    });
});

describe('parseWalkthroughStep', () => {
    it('returns the step a walkthrough link names', () => {
        expect(parseWalkthroughStep({ walkthroughStep: 'signIn' })).toBe('signIn');
    });

    it.each([
        ['no argument', undefined],
        ['null', null],
        ['a string', 'signIn'],
        ['an array', [{ walkthroughStep: 'signIn' }]],
        ['an unknown step', { walkthroughStep: 'somewhere' }],
        ['a non-string step', { walkthroughStep: 3 }],
        ['an object without the field', { other: 'signIn' }],
    ])('ignores %s', (_label, arg) => {
        expect(parseWalkthroughStep(arg)).toBeUndefined();
    });

    it('knows exactly the steps the real manifest contributes, in order', () => {
        const manifest = JSON.parse(readFileSync(join(EXTENSION_ROOT, 'package.json'), 'utf8')) as {
            contributes: { walkthroughs: { steps: { id: string }[] }[] };
        };
        expect([...WALKTHROUGH_STEPS]).toEqual(manifest.contributes.walkthroughs[0].steps.map(s => s.id));
    });
});

describe('WalkthroughNavigator', () => {
    const CATEGORY = 'aet-tum.iris-thaumantias#artemisGetStarted';
    let calls: string[];
    let errors: unknown[];
    let signedIn: () => Promise<boolean>;

    function navigator(overrides: Partial<WalkthroughNavigatorDeps> = {}): WalkthroughNavigator {
        return new WalkthroughNavigator({
            extensionId: 'aet-tum.iris-thaumantias',
            isSignedIn: () => signedIn(),
            markStepComplete: async stepId => { calls.push(`done ${stepId}`); },
            openWalkthrough: async target => { calls.push(`open ${target.category} ${target.step}`); },
            onError: error => { errors.push(error); },
            ...overrides,
        });
    }

    beforeEach(() => {
        calls = [];
        errors = [];
        signedIn = async () => true;
    });

    it('ticks the step, then selects the next one inside this extension\'s walkthrough', async () => {
        await navigator().stepDone('chooseServer');
        expect(calls).toEqual([`done ${CATEGORY}#chooseServer`, `open ${CATEGORY} signIn`]);
    });

    it('skips Meet Iris while signed out, because VS Code would fall back to the first step', async () => {
        signedIn = async () => false;
        await navigator().stepDone('exerciseFolder');
        expect(calls).toEqual([`done ${CATEGORY}#exerciseFolder`, `open ${CATEGORY} preferences`]);
    });

    it('goes to Meet Iris when signed in', async () => {
        await navigator().stepDone('exerciseFolder');
        expect(calls.at(-1)).toBe(`open ${CATEGORY} meetIris`);
    });

    it('only ticks the last step', async () => {
        await navigator().stepDone('preferences');
        expect(calls).toEqual([`done ${CATEGORY}#preferences`]);
    });

    it('still moves on when the tick fails, and reports both failures instead of rejecting', async () => {
        const tickFailure = new Error('no such step');
        const openFailure = new Error('command not found');
        const nav = navigator({
            markStepComplete: async () => { throw tickFailure; },
            openWalkthrough: async target => { calls.push(`open ${target.step}`); throw openFailure; },
        });
        await expect(nav.stepDone('chooseServer')).resolves.toBeUndefined();
        expect(calls).toEqual(['open signIn']);
        expect(errors).toEqual([tickFailure, openFailure]);
    });

    it('treats a failing credential read as signed out', async () => {
        signedIn = async () => { throw new Error('secret storage unavailable'); };
        await navigator().stepDone('exerciseFolder');
        expect(calls.at(-1)).toBe(`open ${CATEGORY} preferences`);
        expect(errors).toHaveLength(1);
    });

    describe('sign-in button', () => {
        it('finishes the step right away when already signed in, and needs no login', async () => {
            await expect(navigator().signInRequested()).resolves.toBe(false);
            expect(calls).toEqual([`done ${CATEGORY}#signIn`, `open ${CATEGORY} exerciseFolder`]);
        });

        it('asks for the login when signed out, and finishes the step after it', async () => {
            signedIn = async () => false;
            const nav = navigator();
            await expect(nav.signInRequested()).resolves.toBe(true);
            expect(calls).toEqual([]);

            await nav.signedIn();
            expect(calls).toEqual([`done ${CATEGORY}#signIn`, `open ${CATEGORY} exerciseFolder`]);
        });

        it('asks for the login when the credential read fails', async () => {
            signedIn = async () => { throw new Error('secret storage unavailable'); };
            await expect(navigator().signInRequested()).resolves.toBe(true);
        });

        it('leaves a login nobody asked for alone, and continues only once per click', async () => {
            signedIn = async () => false;
            const nav = navigator();
            await nav.signedIn();
            expect(calls).toEqual([]);

            await nav.signInRequested();
            await nav.signedIn();
            await nav.signedIn();
            expect(calls).toHaveLength(2);
        });
    });
});
