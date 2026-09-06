import type { StruggleThrottleState } from '@shared/messageContracts';

import type { AlertRecord } from '@extension/services/struggle/types';

import type { AlertSink } from './alertSink';

export interface BackoffSource {
    /** Drop this alert outright (before the throttle) — alerts the orchestrator would provably
     *  discard anyway: course-off / student-opt-out, the awaiting-evidence gate, and delivered-slot
     *  gating. Lives here so a suppressed alert does NOT burn the throttle's per-session/min-gap budget
     *  (the orchestrator's own checks are below the throttle). */
    shouldSuppress(alert: AlertRecord): boolean;
}

/**
 * Delivery-layer suppression gate, placed ABOVE the throttle so a provably-discarded alert is dropped
 * WITHOUT consuming the throttle's per-session/min-gap budget. The suppression predicate lives in the
 * orchestrator (it sees the course/student state); this gate only reads it.
 */
export class BackoffGate implements AlertSink {
    constructor(private readonly inner: AlertSink, private readonly backoff: BackoffSource) {}

    deliver(alert: AlertRecord): void {
        if (this.backoff.shouldSuppress(alert)) {
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

    /** Consent revoked (#349): forward (nothing to clear at this layer). */
    onConsentRevoked(): void {
        if (this.inner.onConsentRevoked) {
            this.inner.onConsentRevoked();
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
