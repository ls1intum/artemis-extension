import X from 'lucide-react/dist/esm/icons/x';

import type { ContentState, ConversationTopic } from '@webview/views/IrisChat/types';

import styles from './ContextChip.module.css';

interface ContextChipProps {
    /** The topic to show: the caller passes `pending ?? committed`. */
    context: ConversationTopic | null | undefined;
    contentState: ContentState;
    /**
     * `selectCanChangeTopic(state)`. False while a send or a navigation is in
     * flight, which makes both affordances inert without hiding them (the
     * chip is the only place the topic is visible, so it must not disappear
     * for the duration of a request).
     */
    canChangeTopic?: boolean;
    onRemove: () => void;
    onOpenPicker: () => void;
}

/**
 * The composer's topic chip. One visual state: it shows `pending ?? committed`
 * and does not distinguish staged from committed, exactly as Artemis's own
 * chip does not.
 *
 * No chip at all when the topic is the course: "course chat" is the absence of
 * a topic, and a chip reading "Kurs-Chat" would claim a scope the conversation
 * does not have.
 *
 * The remove icon appears ONLY while the conversation is empty. There it does
 * what its shape promises: it drops the topic in place, with no request and no
 * visible change beyond the chip. On a conversation with content, removing the
 * topic necessarily means leaving for another conversation, and a small remove
 * icon must not silently replace the whole transcript. There the icon is
 * hidden and the picker's "Kurs-Chat" entry carries that action instead.
 */
export function ContextChip({
    context,
    contentState,
    canChangeTopic = true,
    onRemove,
    onOpenPicker,
}: ContextChipProps) {
    if (!context || context.mode === 'COURSE_CHAT') {
        return null;
    }

    const label = context.name ?? 'Thema';

    return (
        <div className={styles.chip}>
            <button
                type="button"
                className={styles.label}
                onClick={onOpenPicker}
                disabled={!canChangeTopic}
                title="Thema aendern"
            >
                {label}
            </button>
            {contentState === 'empty' && (
                <button
                    type="button"
                    className={styles.remove}
                    onClick={onRemove}
                    disabled={!canChangeTopic}
                    aria-label="Thema entfernen"
                    title="Thema entfernen"
                >
                    <X size={12} />
                </button>
            )}
        </div>
    );
}
