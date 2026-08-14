import { useEffect, useRef } from 'react';

import { ExtensionMsg, isExtensionMessage } from '@shared/messageContracts';

import { useExerciseDetailStore } from '@webview/stores/useExerciseDetailStore';

/** Fallback flush interval in case RAF never fires (e.g. hidden tab) */
const FALLBACK_FLUSH_MS = 1000;

/** Flush threshold: reaching it schedules a flush instead of waiting for the next frame. */
const MAX_BUFFER_SIZE = 100;

/**
 * Buffers incoming WebSocket messages and processes them once per frame, so
 * high-frequency updates cannot cause a re-render storm.
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

            // Push the update fields without `type` so the buffered value
            // stays a member of the discriminated union.
            const { type: _type, ...updateData } = event.data;
            bufferRef.current.push(updateData);

            if (bufferRef.current.length >= MAX_BUFFER_SIZE) {
                setTimeout(flushBuffer, 0);
                return;
            }

            if (rafIdRef.current === null) {
                rafIdRef.current = requestAnimationFrame(flushBuffer);
            }

            if (fallbackTimerRef.current === null) {
                fallbackTimerRef.current = setTimeout(flushBuffer, FALLBACK_FLUSH_MS);
            }
        };

        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);

            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }

            if (fallbackTimerRef.current !== null) {
                clearTimeout(fallbackTimerRef.current);
                fallbackTimerRef.current = null;
            }

            // Clear buffer to prevent stale closure dispatches
            bufferRef.current = [];
        };
    }, [updateBuildStatus, updateSubmission, updateSubmissionProcessing]);
}
