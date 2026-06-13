// extension/src/extension/services/struggle/alerting/alertSink.ts
import type { AlertRecord } from '@extension/services/struggle/types';

/** Delivery interface; the notification implementation arrives in PR 2c. */
export interface AlertSink {
    deliver(alert: AlertRecord): void;
    /** Clear any visible intervention (session change, or interventions disabled). */
    reset?(): void;
}
