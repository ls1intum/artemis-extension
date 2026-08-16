import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    maybeOpenGetStartedWalkthrough,
    type OnboardingDeps,
    type StartupAuthState,
    WALKTHROUGH_ID,
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
