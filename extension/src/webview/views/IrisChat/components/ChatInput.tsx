import clsx from 'clsx';
import Send from 'lucide-react/dist/esm/icons/send';
import { KeyboardEvent, useId, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import styles from './ChatInput.module.css';

interface ChatInputProps {
    onSend: (text: string) => void;
    /**
     * There is nothing to write into: no conversation, Iris switched off,
     * Iris unreachable, transcript not delivered yet. Disables the textarea,
     * the send button and the submit guard.
     */
    disabled: boolean;
    /**
     * Composing is fine, sending has to wait. Disables the send button and
     * the submit guard only; the textarea stays editable and keeps its draft.
     * Deliberately a second flag rather than a wider `disabled`: those are
     * different facts and the student is allowed to act on one of them.
     */
    sendDisabled?: boolean;
    /**
     * Why sending is blocked. Surfaced twice, on the button for the mouse and
     * on the textarea for assistive technology, and only while
     * `sendDisabled && !disabled`.
     */
    sendDisabledLabel?: string;
    placeholder?: string;
    disabledPlaceholder?: string;
    /**
     * Controlled draft text. Supplying it hands the composer's state to the
     * caller (the store's `composerText`, Task 11), which is what lets the
     * draft survive a re-render triggered from outside this component, e.g. a
     * topic change that repaints the chip while the student is typing.
     * Omitted, the component keeps its own local state as before.
     */
    value?: string;
    onValueChange?: (text: string) => void;
}

export function ChatInput({
    onSend,
    disabled,
    sendDisabled = false,
    sendDisabledLabel,
    placeholder = 'Ask Iris anything...',
    disabledPlaceholder = 'Select a course or exercise to start chatting',
    value: controlledValue,
    onValueChange,
}: ChatInputProps) {
    const [localValue, setLocalValue] = useState('');
    const sendBlockedId = useId();
    const value = controlledValue ?? localValue;
    const setValue = (text: string) => {
        if (controlledValue === undefined) {
            setLocalValue(text);
            return;
        }
        onValueChange?.(text);
    };

    // Bound to "you may write but not send". While the composer is disabled
    // outright, sending is blocked for one of four other reasons and this
    // sentence would be a lie.
    const reason = sendDisabled && !disabled ? sendDisabledLabel : undefined;

    const canSend = value.trim().length > 0 && !disabled && !sendDisabled;

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter without Shift sends message
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Shift+Enter inserts newline (default textarea behavior)
    };

    const handleSend = () => {
        // The guard sits AHEAD of the clear on purpose: a blocked Enter must
        // leave the draft exactly where the student left it.
        if (!canSend) { return; }
        onSend(value.trim());
        setValue(''); // Clear input immediately (optimistic)
    };

    return (
        <div className={styles.container}>
            <TextareaAutosize
                className={clsx(styles.textarea, {
                    [styles.disabled]: disabled,
                })}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                    disabled
                        ? disabledPlaceholder
                        : placeholder
                }
                disabled={disabled}
                aria-describedby={reason ? sendBlockedId : undefined}
                minRows={1}
                maxRows={6}
                aria-label="Chat input"
            />
            {reason && (
                <span id={sendBlockedId} className={styles.srOnly}>{reason}</span>
            )}
            <span className={styles.sendWrap} title={reason}>
                <button
                    className={clsx(styles.sendButton, {
                        [styles.sendButtonDisabled]: !canSend,
                        [styles.sendButtonActive]: canSend,
                    })}
                    onClick={handleSend}
                    disabled={!canSend}
                    aria-label="Send message"
                >
                    <Send size={20} />
                </button>
            </span>
        </div>
    );
}
