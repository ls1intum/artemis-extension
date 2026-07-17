// extension/src/extension/services/struggle/alerting/alertSink.ts
import type { StruggleThrottleState } from '@shared/messageContracts';

import type { AlertRecord } from '@extension/services/struggle/types';

/** Delivery interface; the notification implementation arrives in PR 2c. */
export interface AlertSink {
    deliver(alert: AlertRecord): void;
    /** Clear any visible intervention (e.g. interventions disabled mid-session).
     *  Does NOT reset per-session delivery budgets — a config toggle must not
     *  refill the throttle. */
    reset?(): void;
    /** New exercise session: reset ALL delivery state (per-session budget + rate
     *  history) AND clear the visible intervention. */
    resetSession?(): void;
    /** Latest delivery-throttle state for the dev debug snapshot (telemetry only).
     *  A decorator sink forwards to its inner throttle; non-throttle sinks omit it. */
    getThrottleState?(): StruggleThrottleState | undefined;
    /**
     * Called by the coordinator when a build result arrives. `hasNewGreenTest=true`
     * means the result carries a strict new high in passed tests (progress-close latch
     * trigger). Decorator sinks forward; non-participating sinks omit the method.
     */
    onNewBuildResult?(hasNewGreenTest: boolean): void;
    /** Consent revoked mid-session (#349): clear visible surfaces AND terminate local
     *  episode/slot/in-flight state (no egress). PRESERVES the per-session delivery
     *  budget and the 404/course-off latches - revoke->regrant must not refill or lift
     *  anything. Decorator sinks forward; minimal sinks may omit it (callers fall back
     *  to reset). */
    onConsentRevoked?(): void;
}
