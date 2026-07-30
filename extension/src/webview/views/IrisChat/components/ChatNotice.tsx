import { useEffect, useRef } from 'react';

import styles from './ChatNotice.module.css';

/** How long a notice stays up before it fades. */
const NOTICE_TTL_MS = 10_000;

interface ChatNoticeProps {
    notice: { text: string } | null | undefined;
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
    // The conversation this notice was raised under. Written only when the
    // text changes, so a later session change is detectable as a mismatch.
    const noticeSessionRef = useRef<number | null | undefined>(undefined);

    // `currentSessionId` is deliberately NOT a dependency here: this effect
    // records the session at the moment the notice appeared, and re-running it
    // on a session change would erase the very mismatch the next effect looks
    // for. Read through a ref so it is not a stale closure either.
    const currentSessionIdRef = useRef(currentSessionId);
    currentSessionIdRef.current = currentSessionId;
    useEffect(() => {
        if (text !== undefined) {
            noticeSessionRef.current = currentSessionIdRef.current;
        }
    }, [text]);

    useEffect(() => {
        if (text !== undefined && noticeSessionRef.current !== currentSessionId) {
            onExpire();
        }
    }, [text, currentSessionId, onExpire]);

    useEffect(() => {
        if (text === undefined) { return undefined; }
        const timer = setTimeout(onExpire, NOTICE_TTL_MS);
        return () => clearTimeout(timer);
    }, [text, onExpire]);

    if (text === undefined) { return null; }

    return (
        <div className={styles.notice} role="status">
            {text}
        </div>
    );
}
