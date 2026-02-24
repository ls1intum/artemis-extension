import styles from './WelcomeState.module.css';

interface WelcomeStateProps {
    onSendPrompt: (text: string) => void;
    hasContext: boolean;
}

const SUGGESTED_PROMPTS = [
    'Explain the exercise requirements',
    'Help me debug my code',
    'What are the test cases checking?',
];

export function WelcomeState({ onSendPrompt, hasContext }: WelcomeStateProps) {
    if (!hasContext) {
        return (
            <div className={styles.container}>
                <div className={styles.message}>
                    Select a course or exercise to start chatting with Iris.
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.greeting}>
                <div className={styles.avatar}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                        <circle
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="1.5"
                        />
                        <circle cx="9" cy="10" r="1.5" fill="currentColor" />
                        <circle cx="15" cy="10" r="1.5" fill="currentColor" />
                        <path
                            d="M8 15c0 2 1.5 3 4 3s4-1 4-3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                        />
                    </svg>
                </div>
                <h2 className={styles.title}>Hi! I'm Iris, your AI tutor.</h2>
                <p className={styles.subtitle}>How can I help you today?</p>
            </div>

            <div className={styles.promptsContainer}>
                {SUGGESTED_PROMPTS.map((prompt, index) => (
                    <button
                        key={index}
                        className={styles.promptButton}
                        onClick={() => onSendPrompt(prompt)}
                    >
                        {prompt}
                    </button>
                ))}
            </div>
        </div>
    );
}
