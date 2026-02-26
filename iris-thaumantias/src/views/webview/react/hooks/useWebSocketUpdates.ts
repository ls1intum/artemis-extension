import { useEffect, useRef } from 'react';
import type { VsCodeApi, WebSocketUpdateMessage } from '../../../../shared/messageContracts';
import { useExerciseDetailStore } from '../stores/useExerciseDetailStore';

/**
 * RAF-batched WebSocket update hook.
 * Buffers incoming WebSocket messages and processes them once per frame
 * to prevent re-render storms from high-frequency updates.
 */
export function useWebSocketUpdates(vscodeApi: VsCodeApi): void {
    const updateBuildStatus = useExerciseDetailStore((state) => state.updateBuildStatus);
    const updateSubmission = useExerciseDetailStore((state) => state.updateSubmission);
    const updateSubmissionProcessing = useExerciseDetailStore((state) => state.updateSubmissionProcessing);

    const bufferRef = useRef<Array<WebSocketUpdateMessage['payload']>>([]);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        const flushBuffer = (): void => {
            const updates = bufferRef.current;
            bufferRef.current = [];
            rafIdRef.current = null;

            // Process all buffered updates
            for (const update of updates) {
                switch (update.updateType) {
                    case 'newResult':
                        updateBuildStatus(update.data);
                        break;
                    case 'newSubmission':
                        updateSubmission(update.data);
                        break;
                    case 'submissionProcessing':
                        updateSubmissionProcessing(update.data);
                        break;
                }
            }
        };

        const handleMessage = (event: MessageEvent<unknown>): void => {
            const message = event.data as WebSocketUpdateMessage;

            // Filter for websocketUpdate messages
            if (message.type === 'websocketUpdate') {
                const { updateType, data } = message.payload;

                // Add to buffer
                bufferRef.current.push({ updateType, data });

                // Schedule RAF flush if not already scheduled
                if (rafIdRef.current === null) {
                    rafIdRef.current = requestAnimationFrame(flushBuffer);
                }
            }
        };

        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);

            // Cancel pending RAF
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };
    }, [updateBuildStatus, updateSubmission, updateSubmissionProcessing]);
}
