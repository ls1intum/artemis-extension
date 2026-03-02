import { useEffect } from 'react';
import { ExtensionMsg, isExtensionMessage } from '../../../../shared/messageContracts';

/**
 * Listens for `ExtensionMsg.Error` messages and invokes the callback with the error message.
 */
export function useExtensionError(onError: (message: string) => void): void {
    useEffect(() => {
        const handler = (event: MessageEvent<unknown>) => {
            if (!isExtensionMessage(event.data)) {
                return;
            }
            if (event.data.type === ExtensionMsg.Error) {
                onError(event.data.message);
            }
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [onError]);
}
