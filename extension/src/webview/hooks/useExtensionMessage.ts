import { type DependencyList, useEffect } from 'react';

import { type ExtensionToWebviewMessage, isExtensionMessage } from '@shared/messageContracts';

export function useExtensionMessage(
    handler: (msg: ExtensionToWebviewMessage) => void,
    deps: DependencyList,
): void {
    useEffect(() => {
        const listener = (event: MessageEvent<unknown>) => {
            if (isExtensionMessage(event.data)) {
                handler(event.data);
            }
        };
        window.addEventListener('message', listener);
        return () => window.removeEventListener('message', listener);
    }, deps);
}
