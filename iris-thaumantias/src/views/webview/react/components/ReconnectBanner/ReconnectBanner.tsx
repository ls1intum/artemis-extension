import { useEffect, useState } from 'react';
import { ExtensionMsg, isExtensionMessage } from '../../../../../shared/messageContracts';
import styles from './ReconnectBanner.module.css';

export function ReconnectBanner() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const handleMessage = (event: MessageEvent<unknown>) => {
            if (!isExtensionMessage(event.data)) {
                return;
            }

            if (event.data.type === ExtensionMsg.UpdateWebSocketStatus) {
                if (!event.data.isConnected) {
                    setIsVisible(true);
                } else {
                    setTimeout(() => {
                        setIsVisible(false);
                    }, 2000);
                }
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
