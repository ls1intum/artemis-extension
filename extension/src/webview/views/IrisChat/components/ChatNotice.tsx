import { useEffect, useRef } from 'react';

import styles from './ChatNotice.module.css';

/** How long a notice stays up before it fades. */
const NOTICE_TTL_MS = 10_000;

interface ChatNoticeProps {
    notice: { text: string; tone?: 'info' | 'error' } | null | undefined;
    /** The conversation the notice belongs to; a change to it clears the notice. */
    currentSessionId: number | null | undefined;
    /** Clears the notice in the store (timeout, or a navigation happened). */
    onExpire: () => void;
}

/**
 * One muted line above the composer, 10 s then gone.
 *
 * Actionless in PR 1: it carries text and nothing else. The undo button and
 * the saved-staging restoration rules are PR 2, and a button that promises to
 * undo something it cannot yet restore is worse than no button.
 *
 * A notice is cleared by ANY navigation, not only by its own timeout: it
 * describes something the system did to your situation, and once the situation
 * has changed again the sentence is no longer true. The store already clears
 * it on every `setIrisState`; the session guard here is the second line of
 * defence for a navigation that does not go through one.
 */
export function ChatNotice({ notice, currentSessionId, onExpire }: ChatNoticeProps) {
    const text = notice?.text;
    // A refused navigation is the only surface those clicks have, so it is
    // announced and styled as a failure rather than as a muted aside.
    const isError = notice?.tone === 'error';
    // The conversation this notice was raised under. Written only when the
    // text changes, so a later session change is detectable as a mismatch.
    const noticeSessionRef = useRef<number | null | undefined>(undefined);

    // `currentSessionId` is deliberately NOT a dependency here: this effect
    // records the session at the moment the notice appeared, and re-running it
    // on a session change would erase the very mismatch the next effect looks
    // for. Read through a ref so it is not a stale closure either.
    const currentSessionIdRef = useRef(currentSessionId);
    currentSessionIdRef.current = currentSessionId;
    // Likewise for the callback. Callers pass an inline arrow, so it is a new
    // function on every parent render; depending on it would clear and restart
    // the timeout below on each one, and the parent re-renders on every store
    // change (every keystroke, now that the composer is store-backed). The
    // notice would then never expire while the student is typing, which is
    // exactly when it is in the way.
    const onExpireRef = useRef(onExpire);
    onExpireRef.current = onExpire;

    useEffect(() => {
        if (text !== undefined) {
            noticeSessionRef.current = currentSessionIdRef.current;
        }
    }, [text]);

    useEffect(() => {
        if (text !== undefined && noticeSessionRef.current !== currentSessionId) {
            onExpireRef.current();
        }
    }, [text, currentSessionId]);

    useEffect(() => {
        if (text === undefined) { return undefined; }
        const timer = setTimeout(() => onExpireRef.current(), NOTICE_TTL_MS);
        return () => clearTimeout(timer);
    }, [text]);

    if (text === undefined) { return null; }

    return (
        // Static camelCase lookups only: a dynamic `styles[tone]` survives
        // vitest and resolves to undefined in the production bundle.
        <div className={isError ? styles.noticeError : styles.notice} role={isError ? 'alert' : 'status'}>
            {text}
        </div>
    );
}
