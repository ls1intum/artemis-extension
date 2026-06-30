import { useState } from 'react';

import styles from './StaleAskButtons.module.css';

type StaleAskButtonValue = 'solved' | 'still-on-it' | 'something-else';

interface StaleAskButtonsProps {
    askId: string;
    question: string;
    /** Called once (buttons disable after first click). */
    onButton: (button: StaleAskButtonValue) => void;
}

/**
 * Quick-reply buttons rendered below a stale-ask proactive row (C6).
 * All three buttons disable after the first click so the student cannot
 * double-submit. The parent is responsible for posting the command.
 */
export function StaleAskButtons({ question, onButton }: StaleAskButtonsProps) {
    const [clicked, setClicked] = useState(false);

    const handleClick = (button: StaleAskButtonValue) => {
        if (clicked) {
            return;
        }
        setClicked(true);
        onButton(button);
    };

    return (
        <div className={styles.staleAskContainer}>
            {question && <p className={styles.question}>{question}</p>}
            <div className={styles.buttonGroup}>
                <button
                    type="button"
                    className={styles.replyButton}
                    onClick={() => handleClick('solved')}
                    disabled={clicked}
                >
                    Got it, solved!
                </button>
                <button
                    type="button"
                    className={styles.replyButton}
                    onClick={() => handleClick('still-on-it')}
                    disabled={clicked}
                >
                    Still working on it
                </button>
                <button
                    type="button"
                    className={styles.replyButton}
                    onClick={() => handleClick('something-else')}
                    disabled={clicked}
                >
                    Something else
                </button>
            </div>
        </div>
    );
}
