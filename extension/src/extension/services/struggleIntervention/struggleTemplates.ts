import type { StruggleSignal } from './struggleContract';

const FAILING_BUILD = 'A test is failing - read the error message and check that specific case.';
const LONG_PASTE = 'You pasted a lot of code - make sure you understand each part before moving on.';
const STUCK = "You've been on the same spot a while - step back and re-check the logic.";
const GENERIC = 'Stuck? Take a moment to re-read the problem statement and your latest error.';
// TPS fires on stalled, regressed, OR failing builds, so the copy must stay build-output-neutral
// (it must not assume "a test is failing" - a compile-error streak also triggers it).
const NO_PROGRESS = 'Your last few builds have not made progress - slow down and re-read what the build output is telling you.';

/** Deterministic, zero-egress local hint keyed by the signal (spec §9). No code analysis. */
export function templateForSignal(signal: StruggleSignal): string {
    const primary = signal.alert.primaryBoundary;
    if (primary === 'FM' || primary === 'FM_PLUS') {
        return FAILING_BUILD;
    }
    if (primary === 'TPS') {
        return NO_PROGRESS;
    }
    if (primary === 'N1') {
        return LONG_PASTE;
    }
    if (primary === 'STATE') {
        return STUCK;
    }
    if (signal.dominantComponents.some(c => c.name === 'regionPersistence')) {
        return STUCK;
    }
    return GENERIC;
}
