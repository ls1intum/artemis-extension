import type { StruggleThrottleState } from '@shared/messageContracts';

import type { AlertRecord } from '@extension/services/struggle/types';

import type { AlertSink } from './alertSink';

export interface BackoffSource {
    /** Drop this alert outright (before the backoff/throttle) — alerts the orchestrator would provably
     *  discard anyway: course-off / student-opt-out, the awaiting-evidence gate, and delivered-slot
     *  gating. Lives here so a suppressed alert does NOT burn the throttle's per-session/min-gap budget
     *  (the orchestrator's own checks are below the throttle). */
    shouldSuppress(alert: AlertRecord): boolean;
    isPaused(): boolean;
    tryConsumeSoftSkip(): boolean;
}

/**
 * Delivery-layer reject backoff (spec §5.2), placed ABOVE the throttle so a suppressed / paused / soft-skipped
 * alert is dropped WITHOUT consuming the throttle's per-session/min-gap budget. The counters + the suppression
 * predicate live in the orchestrator (it sees recordOutcome + the course/student state); this gate only reads them.
 */
export class BackoffGate implements AlertSink {
    constructor(private readonly inner: AlertSink, private readonly backoff: BackoffSource) {}

    deliver(alert: AlertRecord): void {
        // Suppressed alerts (course-off / student-opt-out / evidence-gate / delivered-slot) never surface, so
        // drop them here — above the throttle — instead of inside the orchestrator (below it), where they
        // would still burn delivery budget.
        if (this.backoff.shouldSuppress(alert)) {
            return;
        }
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

    /** Forward the throttle state from the inner sink (the throttle lives below this gate). */
    getThrottleState(): StruggleThrottleState | undefined {
        return this.inner.getThrottleState?.();
    }

    /** Forward the build-result signal (not suppressed; the latch lives in the orchestrator). */
    onNewBuildResult(hasNewGreenTest: boolean): void {
        this.inner.onNewBuildResult?.(hasNewGreenTest);
    }
}
