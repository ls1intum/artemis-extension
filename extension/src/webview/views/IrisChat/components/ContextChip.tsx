import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import File from 'lucide-react/dist/esm/icons/file';
import X from 'lucide-react/dist/esm/icons/x';

import { contextLabel } from '@webview/views/IrisChat/contextLabel';
import type { ContentState, ConversationTopic } from '@webview/views/IrisChat/types';

import styles from './ContextChip.module.css';

/**
 * What the remove icon promises, per content state. The click is always the
 * same one; what it costs is not, so the wording is not either.
 *
 * `unknown` is a refusal in `resolveTopic`, so the button is disabled and its
 * name says why rather than promising an action it will not perform.
 */
const REMOVE_LABEL: Record<ContentState, string> = {
    empty: 'Remove topic',
    content: 'Switch to the course chat',
    unknown: 'Loading the conversation',
};

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
    /** `store.courseTitle`. Names the course chat; `contextLabel` covers null. */
    courseTitle?: string | null;
    onRemove: () => void;
    /**
     * Receives the click so the caller can record which element opened the
     * picker: it is the element focus must return to on close, and the one
     * whose sibling popovers have to be closed first.
     */
    onOpenPicker: (event: React.MouseEvent) => void;
}

/**
 * The composer's topic chip. One visual state: it shows `pending ?? committed`
 * and does not distinguish staged from committed, exactly as Artemis's own
 * chip does not.
 *
 * A course chat is NOT a pill. It is the absence of a topic, and a pill would
 * give it the same standing as a chosen exercise. It renders as plain text
 * instead, in the same place and still opening the picker, and borrows the
 * pill's background only on hover.
 *
 * The remove icon is always present on a topic pill, and only its wording
 * moves with `contentState` (see {@link REMOVE_LABEL}). It used to be hidden
 * once the conversation had content, on the grounds that the click navigates
 * there rather than removing anything. That was too careful: nothing is
 * destroyed (the conversation survives on the server and in the history), and
 * the same navigation is one click away in the picker either way. A slot that
 * never empties also keeps the pill from changing width mid-conversation.
 */
export function ContextChip({
    context,
    contentState,
    canChangeTopic = true,
    courseTitle,
    onRemove,
    onOpenPicker,
}: ContextChipProps) {
    if (!context) {
        return null;
    }

    if (context.mode === 'COURSE_CHAT') {
        const course = courseTitle || contextLabel(context);
        return (
            <button
                type="button"
                className={styles.courseText}
                onClick={onOpenPicker}
                disabled={!canChangeTopic}
                // The visible text alone would name this button exactly like the
                // header's course button, which opens the course list instead.
                // Two buttons, one name, two destinations is a trap for anyone
                // navigating by accessible name.
                aria-label={`Change topic, currently the whole course: ${course}`}
                title="Change topic"
            >
                <BookOpen size={12} className={styles.icon} aria-hidden="true" />
                <span className={styles.courseLabel}>{course}</span>
            </button>
        );
    }

    // `name` is filled in by the host from the tracked exercises when the
    // server did not send one; the fallback names the entity rather than
    // reading the literal word "Topic".
    const label = contextLabel(context);
    const removeLabel = REMOVE_LABEL[contentState];

    return (
        <div className={styles.chip}>
            <File size={12} className={styles.icon} aria-hidden="true" />
            <button
                type="button"
                className={styles.label}
                onClick={onOpenPicker}
                disabled={!canChangeTopic}
                title="Change topic"
            >
                {label}
            </button>
            <button
                type="button"
                className={styles.remove}
                onClick={onRemove}
                disabled={!canChangeTopic || contentState === 'unknown'}
                aria-label={removeLabel}
                title={removeLabel}
            >
                <X size={12} />
            </button>
        </div>
    );
}
