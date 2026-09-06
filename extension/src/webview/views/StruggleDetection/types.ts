import type { StruggleDebugSnapshot, VsCodeApi } from '@shared/messageContracts';

export interface StruggleData {
    /** v3 decision signal (S_base): drives the Urgency card and the θ comparison. */
    urgency: number;
    isEnabled: boolean;
    developerMode: boolean;
    /** Latest engine timers/counters for the dev dashboard (developer mode only). */
    debug?: StruggleDebugSnapshot;
    /** True in the standalone editor-tab copy (hides back-link, live chart, pop-out button). */
    embedded?: boolean;
}

export interface StruggleDetectionViewProps {
    vscodeApi: VsCodeApi;
}
