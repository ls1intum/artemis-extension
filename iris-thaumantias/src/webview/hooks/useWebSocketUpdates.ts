import { useEffect, useRef } from 'react';
import { ExtensionMsg, isExtensionMessage } from '../../shared/messageContracts';
import { useExerciseDetailStore } from '../stores/useExerciseDetailStore';

/** Fallback flush interval in case RAF never fires (e.g. hidden tab) */
const FALLBACK_FLUSH_MS = 1000;

/** Hard cap on buffered messages — flush immediately when exceeded */
const MAX_BUFFER_SIZE = 100;

/**
 * RAF-batched WebSocket update hook.
 * Buffers incoming WebSocket messages and processes them once per frame
 * to prevent re-render storms from high-frequency updates.
 *
 * Safety features:
 * - Fallback timer: flushes every FALLBACK_FLUSH_MS even if RAF doesn't fire
 * - Max buffer size: immediate flush when buffer exceeds MAX_BUFFER_SIZE
 * - Cleanup: clears buffer on unmount to prevent stale closure dispatches
 */
export function useWebSocketUpdates(): void {
    const updateBuildStatus = useExerciseDetailStore((state) => state.updateBuildStatus);
    const updateSubmission = useExerciseDetailStore((state) => state.updateSubmission);
    const updateSubmissionProcessing = useExerciseDetailStore((state) => state.updateSubmissionProcessing);

    type WsUpdatePayload = { updateType: 'newResult'; data: Parameters<typeof updateBuildStatus>[0] } | { updateType: 'newSubmission'; data: Parameters<typeof updateSubmission>[0] } | { updateType: 'submissionProcessing'; data: Parameters<typeof updateSubmissionProcessing>[0] };
    const bufferRef = useRef<Array<WsUpdatePayload>>([]);
    const rafIdRef = useRef<number | null>(null);
    const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const flushBuffer = (): void => {
            const updates = bufferRef.current;
            bufferRef.current = [];
            rafIdRef.current = null;

            if (fallbackTimerRef.current !== null) {
                clearTimeout(fallbackTimerRef.current);
                fallbackTimerRef.current = null;
            }

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
            if (!isExtensionMessage(event.data)) { return; }
            if (event.data.type !== ExtensionMsg.WebsocketUpdate) { return; }

            // Add to buffer - push update fields (now at root level) to preserve discriminated union
            const { type: _type, ...updateData } = event.data;
            bufferRef.current.push(updateData);

            // Immediate flush if buffer exceeds max size
            if (bufferRef.current.length >= MAX_BUFFER_SIZE) {
                setTimeout(flushBuffer, 0);
                return;
            }

            // Schedule RAF flush if not already scheduled
            if (rafIdRef.current === null) {
                rafIdRef.current = requestAnimationFrame(flushBuffer);
            }

            // Schedule fallback timer in case RAF never fires (hidden tab)
            if (fallbackTimerRef.current === null) {
                fallbackTimerRef.current = setTimeout(flushBuffer, FALLBACK_FLUSH_MS);
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

            // Cancel pending fallback timer
            if (fallbackTimerRef.current !== null) {
                clearTimeout(fallbackTimerRef.current);
                fallbackTimerRef.current = null;
            }

            // Clear buffer to prevent stale closure dispatches
            bufferRef.current = [];
        };
    }, [updateBuildStatus, updateSubmission, updateSubmissionProcessing]);
}
