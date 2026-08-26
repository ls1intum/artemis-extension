import { describe, expect, it } from 'vitest';

import type { ChatState } from '@webview/stores/useChatStore';
import {
    deriveComposerPlaceholder,
    deriveCoursePickerStatus,
    deriveDisabledBannerText,
    deriveStartupState,
    isTranscriptHydrated,
    showsUnavailableBanner,
} from '@webview/views/IrisChat/chatViewState';

/**
 * The chat's shell selection. Each flag distinguishes "nothing is open" from
 * "not told yet" from "we could not ask", and every one of those reads as an
 * ordinary empty chat if the guard behind it is dropped. Pinned here against
 * object literals rather than through a rendered component, because what is
 * being tested is the rule, not the markup.
 */

/** Nothing open, detection settled, no workspace exercise: the cold start. */
const coldStart = {
    hasReceivedInitialIrisState: true,
    detectionState: 'settled',
    courseId: null,
    currentSessionId: null,
    workspaceExerciseId: null,
} satisfies Parameters<typeof deriveStartupState>[0];

describe('deriveStartupState', () => {
    it('reports the cold start when detection settled on nothing', () => {
        const state = deriveStartupState(coldStart, false);

        expect(state.isColdStart).toBe(true);
        expect(state.showCourseChooser).toBe(true);
        // The chooser IS the ordinary shell's replacement, not an overlay on
        // top of it, so the header must still be drawn.
        expect(state.suppressOrdinaryShell).toBe(false);
    });

    it('shows nothing before the first snapshot', () => {
        // "Nothing is open" and "not told yet" are indistinguishable here, and
        // guessing the former flashes the course chooser at every student who
        // does have a conversation.
        const state = deriveStartupState({ ...coldStart, hasReceivedInitialIrisState: false }, false);

        expect(state.isColdStart).toBe(false);
        expect(state.startupPending).toBe(false);
        expect(state.detectionUnavailable).toBe(false);
        expect(state.showCourseChooser).toBe(false);
    });

    it('waits rather than offering the chooser while detection is unsettled', () => {
        // Detection is asynchronous: an unsettled state can say "nothing is
        // open" while the extension is still working out which exercise the
        // folder is.
        const state = deriveStartupState({ ...coldStart, detectionState: 'unsettled' }, false);

        expect(state.startupPending).toBe(true);
        expect(state.isColdStart).toBe(false);
        expect(state.suppressOrdinaryShell).toBe(true);
        expect(state.showCourseChooser).toBe(false);
    });

    it('treats an open conversation as "open" even with no course', () => {
        // `nothingOpen` needs BOTH ids null. A session without a course is a
        // real conversation, and every startup screen must stand down for it.
        const state = deriveStartupState({ ...coldStart, currentSessionId: 7 }, true);

        expect(state).toMatchObject({
            isColdStart: false,
            startupPending: false,
            detectionUnavailable: false,
            showCourseChooser: false,
        });
    });

    it('lets a detected workspace exercise through the outage and waiting screens', () => {
        // `workspaceExerciseId` narrows the cold start ONLY. A detection that
        // failed, or has not answered, is still that regardless of what an
        // earlier detection found.
        const detected = { ...coldStart, workspaceExerciseId: 5 };

        expect(deriveStartupState({ ...detected, detectionState: 'unavailable' }, false).detectionUnavailable).toBe(true);
        expect(deriveStartupState({ ...detected, detectionState: 'unsettled' }, false).startupPending).toBe(true);
    });

    it('is not a cold start when a workspace exercise was detected', () => {
        const state = deriveStartupState({ ...coldStart, workspaceExerciseId: 5 }, false);

        expect(state.isColdStart).toBe(false);
        expect(state.showCourseChooser).toBe(false);
    });

    it('separates a detection outage from "no exercise here"', () => {
        const state = deriveStartupState({ ...coldStart, detectionState: 'unavailable' }, false);

        expect(state.detectionUnavailable).toBe(true);
        expect(state.isColdStart).toBe(false);
        // The student must not be asked to pick a course as if the folder
        // simply were not an exercise.
        expect(state.showCourseChooser).toBe(false);
    });

    it('lets the student off the outage screen without clearing it', () => {
        // Detection can fail identically on every retry, so Retry cannot be
        // the only way out. The header stays suppressed: there is still no
        // course to put in it.
        const state = deriveStartupState({ ...coldStart, detectionState: 'unavailable' }, true);

        expect(state.showCourseChooser).toBe(true);
        expect(state.suppressOrdinaryShell).toBe(true);
    });

    it('leaves a disabled course its own banner instead of an outage screen', () => {
        // Entering a course whose Iris is switched off deliberately sets
        // `courseId` and leaves `currentSessionId` null. Without the courseId
        // guard, a failed background detection would cover that course's
        // banner with a startup-outage screen.
        const state = deriveStartupState(
            { ...coldStart, detectionState: 'unavailable', courseId: 42 }, false,
        );

        expect(state.detectionUnavailable).toBe(false);
        expect(state.suppressOrdinaryShell).toBe(false);
    });

    it('reports none of the startup screens once a conversation is open', () => {
        const state = deriveStartupState(
            { ...coldStart, courseId: 42, currentSessionId: 7 }, false,
        );

        expect(state).toMatchObject({
            isColdStart: false,
            startupPending: false,
            detectionUnavailable: false,
            suppressOrdinaryShell: false,
            showCourseChooser: false,
        });
    });
});

describe('deriveCoursePickerStatus', () => {
    const courses = [{ id: 1 }] as unknown as ChatState['courses'];

    it('reports loading ahead of everything else', () => {
        expect(deriveCoursePickerStatus({ coursesUnavailable: true, courses: [] }, true)).toBe('loading');
    });

    it('reports ready when the list was fetched', () => {
        expect(deriveCoursePickerStatus({ coursesUnavailable: false, courses: [] }, false)).toBe('ready');
    });

    it('separates an outage with nothing to show from one with stale rows', () => {
        // With no rows the failure is all there is to show; with rows they stay
        // pickable but unconfirmed, and saying so keeps the picker from
        // presenting a stale list as current.
        expect(deriveCoursePickerStatus({ coursesUnavailable: true, courses: [] }, false)).toBe('error');
        expect(deriveCoursePickerStatus({ coursesUnavailable: true, courses }, false)).toBe('stale');
    });
});

describe('deriveDisabledBannerText', () => {
    it('prefers the host message over the .noai wording', () => {
        // Both can be true at once; the host's carries strictly more.
        const text = deriveDisabledBannerText({ disabledMessage: 'Instructor disabled Iris.', isNoAiDetected: true });

        expect(text).toBe('Instructor disabled Iris.');
    });

    it('explains a .noai workspace on its own', () => {
        expect(deriveDisabledBannerText({ disabledMessage: null, isNoAiDetected: true }))
            .toContain('.noai file was detected');
    });

    it('is absent when Iris is usable', () => {
        expect(deriveDisabledBannerText({ disabledMessage: null, isNoAiDetected: false })).toBeNull();
    });
});

describe('showsUnavailableBanner', () => {
    it('yields to the disabled banner', () => {
        // Two banners for one problem read as one of them being broken.
        expect(showsUnavailableBanner({ unavailableMessage: 'Iris is unreachable.', disabledMessage: 'off' })).toBe(false);
        expect(showsUnavailableBanner({ unavailableMessage: 'Iris is unreachable.', disabledMessage: null })).toBe(true);
    });
});

describe('deriveComposerPlaceholder', () => {
    const usable = {
        disabledMessage: null,
        isNoAiDetected: false,
        unavailableMessage: null,
        currentSessionId: 7,
    };
    const noScreen = { showCourseChooser: false, startupPending: false, detectionUnavailable: false };

    it('says nothing when the composer is usable', () => {
        expect(deriveComposerPlaceholder(usable, noScreen)).toBeUndefined();
    });

    it('names the real reason instead of sending the student back to the picker', () => {
        // Entering a course whose Iris is off leaves a course and no
        // conversation, and "Choose a course" would point past the banner that
        // already gives the reason.
        const text = deriveComposerPlaceholder(
            { ...usable, disabledMessage: 'off', currentSessionId: null }, noScreen,
        );

        expect(text).toBe('Iris chat is not available here');
    });

    it('agrees with the course chooser rather than the outage behind it', () => {
        // Once the outage screen is bypassed, the message area shows the
        // picker, so the composer must say the same.
        const text = deriveComposerPlaceholder(
            { ...usable, currentSessionId: null },
            { showCourseChooser: true, startupPending: false, detectionUnavailable: true },
        );

        expect(text).toBe('Choose a course to start chatting');
    });

    it('does not invite a choice before detection has answered', () => {
        // There may turn out to be nothing to choose from at all.
        const text = deriveComposerPlaceholder(
            { ...usable, currentSessionId: null },
            { ...noScreen, startupPending: true },
        );

        expect(text).toBe('Looking for your Artemis exercise…');
    });

    it('does not blame the server for a failed detection', () => {
        // The same screen covers a stored credential the keychain could not
        // read, which is local.
        const text = deriveComposerPlaceholder(
            { ...usable, currentSessionId: null },
            { ...noScreen, detectionUnavailable: true },
        );

        expect(text).toBe('Detecting your Artemis exercise failed. Retry above.');
    });

    it('names .noai when nothing else outranks it', () => {
        const text = deriveComposerPlaceholder({ ...usable, isNoAiDetected: true }, noScreen);

        expect(text).toBe('AI assistance is disabled (.noai detected)');
    });

    it('keeps its precedence when several reasons are true at once', () => {
        // Each pair is reachable, and each would read wrong under the other
        // ordering. Asserting them is what makes the if/else chain's order a
        // rule rather than an accident.
        expect(deriveComposerPlaceholder(
            { ...usable, disabledMessage: 'off', currentSessionId: null },
            { ...noScreen, showCourseChooser: true },
        )).toBe('Iris chat is not available here');

        expect(deriveComposerPlaceholder(
            { ...usable, disabledMessage: 'off', unavailableMessage: 'unreachable' },
            noScreen,
        )).toBe('Iris chat is not available here');

        // No conversation outranks .noai: "Choose a course" is the actionable
        // one, and the .noai banner already states the other.
        expect(deriveComposerPlaceholder(
            { ...usable, currentSessionId: null, isNoAiDetected: true },
            noScreen,
        )).toBe('Choose a course to start chatting');

        expect(deriveComposerPlaceholder(
            { ...usable, isNoAiDetected: true, unavailableMessage: 'unreachable' },
            noScreen,
        )).toBe('AI assistance is disabled (.noai detected)');
    });

    it('offers the retry wording for a transient outage', () => {
        const text = deriveComposerPlaceholder(
            { ...usable, unavailableMessage: 'Iris is unreachable.' }, noScreen,
        );

        expect(text).toBe('Iris is temporarily unavailable. Retry to reload.');
    });
});

describe('isTranscriptHydrated', () => {
    it('is false before the first snapshot', () => {
        expect(isTranscriptHydrated({
            hasReceivedInitialIrisState: false, currentSessionId: null, loadedSessionId: null,
        })).toBe(false);
    });

    it('is true with nothing open: the legitimate steady state', () => {
        expect(isTranscriptHydrated({
            hasReceivedInitialIrisState: true, currentSessionId: null, loadedSessionId: null,
        })).toBe(true);
    });

    it('covers the gap between a conversation opening and its transcript arriving', () => {
        // This gap is exactly what the loader exists for; reporting it as
        // hydrated renders an open conversation as an empty one.
        expect(isTranscriptHydrated({
            hasReceivedInitialIrisState: true, currentSessionId: 7, loadedSessionId: null,
        })).toBe(false);
        expect(isTranscriptHydrated({
            hasReceivedInitialIrisState: true, currentSessionId: 7, loadedSessionId: 6,
        })).toBe(false);
        expect(isTranscriptHydrated({
            hasReceivedInitialIrisState: true, currentSessionId: 7, loadedSessionId: 7,
        })).toBe(true);
    });
});
