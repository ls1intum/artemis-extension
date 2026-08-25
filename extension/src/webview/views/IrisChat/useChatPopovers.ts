import { useEffect, useRef, useState } from 'react';

import { useClickOutside } from '@webview/hooks/useClickOutside';
import type { ChatState } from '@webview/stores/useChatStore';
import { useChatStore } from '@webview/stores/useChatStore';

interface PopoverOptions {
    /**
     * The view's own subscription, passed down rather than re-subscribed here:
     * a second whole-store subscription in the same component costs an extra
     * update notification per store write for no added reactivity.
     */
    store: Pick<ChatState, 'currentSessionId' | 'courseId' | 'streaming' | 'setOpenSessionError'>;
    /** Opening the course picker asks the host for the live list. */
    requestCourses: () => void;
}

/**
 * The chat's three navigation popovers and the side menu: which one is open,
 * and the two rules that close them by themselves.
 *
 * They belong together because they are mutually exclusive and share one
 * closing discipline. Each remembers the element that opened it so focus can
 * be restored, and each captures the conversation it was opened against, which
 * is what lets a landed navigation dismiss it. Spread through a component
 * those rules were four near-identical open handlers whose differences were
 * invisible.
 */
export function useChatPopovers({ store, requestCourses }: PopoverOptions) {
    const { setOpenSessionError, currentSessionId, courseId } = store;
    const isStreaming = store.streaming.isStreaming;

    const [sideMenuOpen, setSideMenuOpen] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [coursePickerOpen, setCoursePickerOpen] = useState(false);

    const sideMenuRef = useRef<HTMLDivElement>(null);
    // Element that opened the currently-visible popover, captured so focus can
    // be restored to it on close. One shared ref because a click-outside close
    // must return focus to whichever opener was actually clicked.
    const openerRef = useRef<HTMLElement | null>(null);

    // A navigation-initiating popover stays open until the navigation lands, so
    // a failure has somewhere to be read (`openSessionError`). The success
    // signal is the conversation differing from the one CAPTURED at open time:
    // `currentSessionId` is legitimately `null` whenever nothing is open, so
    // `null` cannot double as "no popover is open". `undefined` can, it is not
    // part of the field's type.
    const sessionWhenOpened = useRef<number | null | undefined>(undefined);
    // The course is captured alongside it, because a course move does not
    // always change the conversation id: entering a course whose Iris is
    // switched off leaves it null, and it may have been null before. Without
    // this the picker stays parked on top of the banner that explains where the
    // student now is.
    const courseWhenOpened = useRef<number | null | undefined>(undefined);

    useClickOutside(sideMenuRef, sideMenuOpen, () => setSideMenuOpen(false));

    const closePopovers = () => {
        setPickerOpen(false);
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        setOpenSessionError(null);
        sessionWhenOpened.current = undefined;
        courseWhenOpened.current = undefined;
        openerRef.current?.focus();
        openerRef.current = null;
    };

    /** Everything an open handler shares: exclusivity, focus, and the capture. */
    const beginOpen = (opener: HTMLElement) => {
        openerRef.current = opener;
        setPickerOpen(false);
        setHistoryOpen(false);
        setCoursePickerOpen(false);
        sessionWhenOpened.current = useChatStore.getState().currentSessionId;
        courseWhenOpened.current = useChatStore.getState().courseId;
    };

    useEffect(() => {
        if (sessionWhenOpened.current === undefined) { return; }
        if (currentSessionId !== sessionWhenOpened.current || courseId !== courseWhenOpened.current) {
            // Also clears `openSessionError`, so a failure the student has
            // since navigated past cannot sit on top of the conversation that
            // did load.
            closePopovers();
        }
    }, [currentSessionId, courseId]);

    // Run lock: navigation cannot abandon an in-flight run. The moment
    // streaming starts, close/neutralize any popover or side menu that was
    // already open. Without this, a late click inside one (still mounted from
    // before the run began) could post a context/session-changing command.
    // ChatHeader's `disableNavigation` covers the still-closed case.
    useEffect(() => {
        if (isStreaming) {
            setSideMenuOpen(false);
            closePopovers();
        }
    }, [isStreaming]);

    return {
        sideMenuOpen,
        setSideMenuOpen,
        sideMenuRef,
        pickerOpen,
        historyOpen,
        coursePickerOpen,
        closePopovers,

        /**
         * The topic picker. The capture in `beginOpen` is what makes the
         * auto-close effect fire for it at all, so a navigation the student did
         * not start (an Ask-Iris command landing on another course) cannot swap
         * the rows under the cursor and have the click stage a DIFFERENT
         * course's exercise.
         */
        openPicker: (opener: HTMLElement) => {
            beginOpen(opener);
            setPickerOpen(true);
        },

        openCoursePicker: (opener: HTMLElement) => {
            beginOpen(opener);
            requestCourses();
            // Symmetric with `openHistory`: without this, a send-path error
            // from `reportError` (which names a send, not a course) renders as
            // an alert inside "Select course" arbitrarily long after the send
            // that caused it.
            setOpenSessionError(null);
            setCoursePickerOpen(true);
        },

        openHistory: (opener: HTMLElement) => {
            beginOpen(opener);
            setOpenSessionError(null);
            // The conversation list comes with the snapshot, so opening it
            // costs no request.
            setHistoryOpen(true);
        },
    };
}
