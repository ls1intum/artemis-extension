import type { StruggleAction, StruggleSignal } from './struggleContract';

export interface InterventionLogEvent {
    action: StruggleAction | 'requested';   // what we did / server proposed
    finalAction: StruggleAction;             // surfaced level after gating
    surface: 'none' | 'lamp' | 'bubble' | 'inline';
    source: 'server' | 'local';
    /** The originating signal (alert + trajectory) - the analytic payload (spec §12). */
    signal?: StruggleSignal;
    confidence?: number;                     // server confidence (active/ambient AI path), when known
    /** The gate's own one-sentence reason for the decision. Never shown to the student; it is here so the
     *  eval can read WHY a run decided as it did, not just what it decided (spec §12). */
    rationale?: string;
    studentOutcome?: 'shown' | 'clicked' | 'dismissed';
}

export type AppendLine = (line: string) => Promise<void>;
export type NowMs = () => number;

/** Always-on, local-only JSONL intervention log for offline evaluation (spec §12). No egress. */
export class InterventionEventLog {
    constructor(private readonly _append: AppendLine, private readonly _now: NowMs) {}

    async record(event: InterventionLogEvent): Promise<void> {
        const line = JSON.stringify({ type: 'struggle-intervention', timestamp: this._now(), ...event }) + '\n';
        try {
            await this._append(line);
        }
        catch {
            // logging must never break the feature
        }
    }
}
