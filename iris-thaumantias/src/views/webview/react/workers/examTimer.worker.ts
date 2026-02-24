/**
 * Web Worker for exam countdown timer.
 * Runs on a separate thread to avoid main-thread throttling when tab is backgrounded.
 * Uses absolute end timestamp to prevent drift.
 */

let timerId: number | null = null;

interface StartMessage {
    type: 'START';
    endTime: number;
}

interface StopMessage {
    type: 'STOP';
}

type WorkerMessage = StartMessage | StopMessage;

interface TickMessage {
    type: 'TICK';
    remaining: number;
    expired: boolean;
}

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    const { type } = event.data;

    if (type === 'START') {
        const { endTime } = event.data as StartMessage;

        // Clear existing timer if any
        if (timerId !== null) {
            clearInterval(timerId);
        }

        // Tick function calculates remaining time
        const tick = () => {
            const now = Date.now();
            const remaining = Math.max(0, endTime - now);
            const expired = remaining === 0;

            const message: TickMessage = {
                type: 'TICK',
                remaining,
                expired,
            };

            self.postMessage(message);

            // Stop timer when expired
            if (expired && timerId !== null) {
                clearInterval(timerId);
                timerId = null;
            }
        };

        // Tick immediately, then every second
        tick();
        timerId = setInterval(tick, 1000) as unknown as number;
    } else if (type === 'STOP') {
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    }
});
