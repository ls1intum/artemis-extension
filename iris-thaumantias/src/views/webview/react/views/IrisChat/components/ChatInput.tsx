import { useState, KeyboardEvent } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import clsx from 'clsx';
import styles from './ChatInput.module.css';

interface ChatInputProps {
    onSend: (text: string) => void;
    disabled: boolean;
    placeholder?: string;
    disabledPlaceholder?: string;
}

export function ChatInput({
    onSend,
    disabled,
    placeholder = 'Ask Iris anything...',
    disabledPlaceholder = 'Select a course or exercise to start chatting',
}: ChatInputProps) {
    const [value, setValue] = useState('');

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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path
                        d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            </button>
        </div>
    );
}
