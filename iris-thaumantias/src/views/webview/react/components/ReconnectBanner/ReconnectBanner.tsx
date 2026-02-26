import { useEffect, useState } from 'react';
import styles from './ReconnectBanner.module.css';

export function ReconnectBanner() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>) => {
            const message = event.data;

            if (typeof message !== 'object' || message === null || !('command' in message)) {
                return;
            }

            const typedMessage = message as { command: string };

            if (typedMessage.command === 'websocketDisconnected') {
                setIsVisible(true);
            } else if (typedMessage.command === 'websocketConnected') {
                // Dismiss banner 2 seconds after reconnect
                setTimeout(() => {
                    setIsVisible(false);
                }, 2000);
            }
        };

        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    if (!isVisible) {
        return null;
    }

    return (
        <div className={styles.reconnectBanner}>
            Reconnecting to Artemis...
        </div>
    );
}
