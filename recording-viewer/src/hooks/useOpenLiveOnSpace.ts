import { useEffect } from 'react';

/** True while an interactive control is focused, where Space has its own meaning
 *  (activating a button, toggling a checkbox, text entry). The shortcut must not
 *  fire in that case — e.g. Space on a focused "Delete"/"Open Folder" button must
 *  activate the button, not open the live session. */
function isInteractiveElementFocused(): boolean {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A') {
        return true;
    }
    if (el.isContentEditable) return true;
    const role = el.getAttribute('role');
    return role === 'button' || role === 'checkbox' || role === 'link' || role === 'menuitem' || role === 'tab';
}

/**
 * On the session list (no session open), pressing Space opens a live recording.
 * Only active while `enabled` is true and at least one live session exists, so
 * the shortcut is strictly a live-recording convenience and never hijacks Space
 * elsewhere (e.g. while a session is open or while typing in an input).
 *
 * If more than one session is live, the first one (insertion order) is opened.
 */
export function useOpenLiveOnSpace(
    enabled: boolean,
    liveIds: Set<string>,
    onOpenLive: (sessionId: string) => void,
): void {
    useEffect(() => {
        if (!enabled || liveIds.size === 0) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== ' ' && e.code !== 'Space') return;
            if (e.repeat || isInteractiveElementFocused()) return;
            const first = liveIds.values().next().value;
            if (!first) return;
            e.preventDefault();
            onOpenLive(first);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [enabled, liveIds, onOpenLive]);
}
