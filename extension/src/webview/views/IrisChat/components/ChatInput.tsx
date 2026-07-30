import clsx from 'clsx';
import Send from 'lucide-react/dist/esm/icons/send';
import { KeyboardEvent, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

import styles from './ChatInput.module.css';

interface ChatInputProps {
    onSend: (text: string) => void;
    disabled: boolean;
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
    placeholder = 'Ask Iris anything...',
    disabledPlaceholder = 'Select a course or exercise to start chatting',
    value: controlledValue,
    onValueChange,
}: ChatInputProps) {
    const [localValue, setLocalValue] = useState('');
    const value = controlledValue ?? localValue;
    const setValue = (text: string) => {
        if (controlledValue === undefined) {
            setLocalValue(text);
            return;
        }
        onValueChange?.(text);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        // Enter without Shift sends message
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
        // Shift+Enter inserts newline (default textarea behavior)
    };

    const handleSend = () => {
        const trimmed = value.trim();
        if (trimmed && !disabled) {
            onSend(trimmed);
            setValue(''); // Clear input immediately (optimistic)
        }
    };

    const canSend = value.trim().length > 0 && !disabled;

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
                minRows={1}
                maxRows={6}
                aria-label="Chat input"
            />
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
        </div>
    );
}
