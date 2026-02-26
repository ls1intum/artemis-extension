import { useEffect, useState } from 'react';
// @ts-expect-error - esbuild-plugin-inline-worker transforms this import (TS1192: requires module declaration)
import ExamTimerWorker from '../workers/examTimer.worker';

interface TimerState {
    remaining: number;
    expired: boolean;
}

interface TickMessage {
    type: 'TICK';
    remaining: number;
    expired: boolean;
}

/**
 * Hook that spawns a Web Worker to run an exam countdown timer.
 * Uses absolute end timestamp to prevent drift when tab is backgrounded.
 *
 * @param endTime - Absolute end timestamp in milliseconds (Date.now() format), or null to disable timer
 * @returns Timer state with remaining milliseconds and expired flag
 */
export function useExamTimer(endTime: number | null): TimerState {
    const [state, setState] = useState<TimerState>({
        remaining: 0,
        expired: false,
    });

    useEffect(() => {
        if (endTime === null) {
            return;
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- esbuild-plugin-inline-worker transforms this import
        const worker = new ExamTimerWorker() as Worker;

        worker.onmessage = (event: MessageEvent<TickMessage>) => {
            if (event.data.type === 'TICK') {
                setState({
                    remaining: event.data.remaining,
                    expired: event.data.expired,
                });
            }
        };

        // Start the timer
        worker.postMessage({ type: 'START', endTime });

        // Cleanup: stop and terminate worker
        return () => {
            worker.postMessage({ type: 'STOP' });
            worker.terminate();
        };
    }, [endTime]);

    return state;
}
