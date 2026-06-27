import type { AlertRecord } from '@extension/services/struggle/types';

import type { AlertSink } from './alertSink';

export interface BackoffSource {
    isPaused(): boolean;
    tryConsumeSoftSkip(): boolean;
}

/**
 * Delivery-layer reject backoff (spec §5.2), placed ABOVE the throttle so a paused/soft-skipped alert is dropped
 * WITHOUT consuming the throttle's per-session/min-gap budget. The counters live in the orchestrator (it sees
 * recordOutcome); this gate only reads them.
 */
export class BackoffGate implements AlertSink {
    constructor(private readonly inner: AlertSink, private readonly backoff: BackoffSource) {}

    deliver(alert: AlertRecord): void {
        if (this.backoff.isPaused()) {
            return;
        }
        if (this.backoff.tryConsumeSoftSkip()) {
            return;
        }
        this.inner.deliver(alert);
    }

    reset(): void {
        this.inner.reset?.();
    }

    resetSession(): void {
        if (this.inner.resetSession) {
            this.inner.resetSession();
        } else {
            this.inner.reset?.();
        }
    }
}
