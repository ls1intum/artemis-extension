import styles from './WelcomeState.module.css';

interface WelcomeStateProps {
    onSendPrompt: (text: string) => void;
    hasContext: boolean;
    isChatDisabled?: boolean;
}

const SUGGESTED_PROMPTS = [
    'Explain the exercise requirements',
    'Help me debug my code',
    'What are the test cases checking?',
];

export function WelcomeState({ onSendPrompt, hasContext, isChatDisabled }: WelcomeStateProps) {
    if (!hasContext) {
        return (
            <div className={styles.container}>
                <div className={styles.message}>
                    Select a course or exercise to start chatting with Iris.
                </div>
            </div>
        );
    }

    const irisLogoUri = document.getElementById('root')?.dataset.irisLogoUri;

    if (isChatDisabled) {
        return (
            <div className={styles.container}>
                <div className={styles.greeting}>
                    {irisLogoUri && (
                        <img src={irisLogoUri} alt="" className={styles.avatar} width="48" height="48" />
                    )}
                    <p className={styles.subtitle}>
                        Iris is not available for this exercise.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.greeting}>
                {irisLogoUri && (
                    <img src={irisLogoUri} alt="" className={styles.avatar} width="48" height="48" />
                )}
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
