import styles from './ContextSwapRow.module.css';

interface ContextSwapRowProps {
    /** The stored marker text ("Thema gesetzt auf X", "Thema entfernt", ...). */
    text: string;
}

/**
 * The full-width transcript marker for a server-side topic change, mirroring
 * Artemis's `iris-context-switch-divider.component.html`.
 *
 * Not clickable: unlike the web client we have no exercise page to route to,
 * and a divider that looks interactive but is not would be worse than a plain
 * one. It renders in transcript order, so it appears before the message that
 * triggered it, matching the server's write order.
 */
export function ContextSwapRow({ text }: ContextSwapRowProps) {
    return (
        <div className={styles.row} data-testid="message-row">
            <span className={styles.rule} aria-hidden="true" />
            <span className={styles.text}>{text}</span>
            <span className={styles.rule} aria-hidden="true" />
        </div>
    );
}
