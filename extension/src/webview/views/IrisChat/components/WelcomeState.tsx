import styles from './WelcomeState.module.css';

interface WelcomeStateProps {
    onSendPrompt: (text: string) => void;
    hasContext: boolean;
    isChatDisabled?: boolean;
    /**
     * Sending is refused right now. These prompt buttons ARE sends, so they
     * go inert alongside the send button: without this they are the one send
     * affordance left that reaches the funnel, and the funnel refuses in
     * silence, with no bubble and no notice to show for the click.
     */
    sendDisabled?: boolean;
    /**
     * Why sending is blocked. Hung on the container rather than the buttons
     * because a disabled button swallows the hover that would show it, same
     * as the send button's wrapper in ChatInput.
     */
    sendDisabledLabel?: string;
}

const SUGGESTED_PROMPTS = [
    'Explain the exercise requirements',
    'Help me debug my code',
    'What are the test cases checking?',
];

export function WelcomeState({
    onSendPrompt,
    hasContext,
    isChatDisabled,
    sendDisabled = false,
    sendDisabledLabel,
}: WelcomeStateProps) {
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

            <div
                className={styles.promptsContainer}
                title={sendDisabled ? sendDisabledLabel : undefined}
            >
                {SUGGESTED_PROMPTS.map((prompt, index) => (
                    <button
                        key={index}
                        className={styles.promptButton}
                        onClick={() => onSendPrompt(prompt)}
                        disabled={sendDisabled}
                    >
                        {prompt}
                    </button>
                ))}
            </div>
        </div>
    );
}
