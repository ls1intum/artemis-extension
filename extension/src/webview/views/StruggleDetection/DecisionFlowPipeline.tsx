import { Fragment } from 'react';

import type { BoundaryType, LiveDecisionTrace, StruggleDebugSnapshot } from '@shared/messageContracts';

import { Badge, Container } from '@webview/components';

import styles from './DecisionFlowPipeline.module.css';
import type { EditTraceReason } from './glossary';
import { discreteText, GLOSSARY, reasonText } from './glossary';
import { mmss, useEngineCountdowns } from './useEngineCountdowns';

interface DecisionFlowPipelineProps {
    debug: StruggleDebugSnapshot;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

/**
 * The five detector gates in engine evaluation order, paired with their live flag. The urgency
 * threshold (`below-threshold`) is deliberately NOT listed here: it is the Severity stage above,
 * so listing it again would double-represent it. The first three read the student's MOMENT
 * (stage 2); the last two read the engine's own HISTORY (stage 4, after the threshold).
 */
const MOMENT_GATES: { reason: EditTraceReason; flag: keyof LiveDecisionTrace['gates'] }[] = [
    { reason: 'b2-fluent-typing', flag: 'fluentTyping' },
    { reason: 'b4-grace-filter', flag: 'grace' },
    { reason: 'd1-warmup', flag: 'warmup' },
];

const HISTORY_GATES: { reason: EditTraceReason; flag: keyof LiveDecisionTrace['gates'] }[] = [
    { reason: 'cooldown', flag: 'cooldown' },
    { reason: 'not-rearmed', flag: 'notRearmed' },
];

/**
 * Stage index of each short-circuit reason, in the REAL evaluation order of the engine
 * (alertStateMachine Step 2, order load-bearing; mirrored by the thesis pipeline figure):
 *   0 candidate → 1 moment gates (B2/B4/D1) → 2 threshold → 3 cooldown/re-arm → 4 fired.
 * Because the machine short-circuits in exactly this order, every stage LEFT of the recorded
 * reason was actually evaluated and passed this tick; every stage RIGHT of it was not reached.
 */
const STAGE_OF_REASON: Record<EditTraceReason, number> = {
    'no-candidate': 0,
    'b2-fluent-typing': 1,
    'b4-grace-filter': 1,
    'd1-warmup': 1,
    'below-threshold': 2,
    'cooldown': 3,
    'not-rearmed': 3,
    'fired': 4,
};

/** Compact lowercase labels for a blocked stage box (distinct from the gate-row labels). */
const STAGE_BLOCK_LABEL: Partial<Record<EditTraceReason, string>> = {
    'b2-fluent-typing': 'fluent typing',
    'b4-grace-filter': 'grace window',
    'd1-warmup': 'warm-up',
    'cooldown': 'in cooldown',
    'not-rearmed': 'not re-armed',
};

type StageStatus = 'pass' | 'block' | 'neutral';

interface Stage {
    name: string;
    status: StageStatus;
    value: string;
    sub: string;
}

function boundaryShort(b: BoundaryType | undefined): string {
    return b ? (GLOSSARY[b].short ?? GLOSSARY[b].code) : 'none';
}

function stageClass(status: StageStatus): string {
    return status === 'pass' ? styles.pass : status === 'block' ? styles.block : '';
}

/**
 * One gate row. A gate only counts as the blocker when it is the engine's recorded decision
 * reason; otherwise an active condition (e.g. warm-up while there is no boundary) is just
 * "engaged". On a FIRED tick the flow stopped nowhere, so a still-true warm-up/grace flag
 * (FM/E4 broke through warm-up, FM survived the grace filter) is NOT "engaged" — it is clear.
 */
function renderGate(
    { reason: r, flag }: { reason: EditTraceReason; flag: keyof LiveDecisionTrace['gates'] },
    trace: LiveDecisionTrace,
    reason: EditTraceReason,
) {
    const blocking = reason === r;
    const engaged = trace.gates[flag] && reason !== 'fired';
    const status = blocking ? 'blocking' : engaged ? 'engaged' : 'clear';
    return (
        <div
            key={flag}
            className={`${styles.gate} ${blocking ? styles.gateBlocking : engaged ? styles.gateOn : ''}`}
            title={GLOSSARY[r].tooltip}
        >
            <span className={styles.gateDot} />
            <span className={styles.gateName}>{GLOSSARY[r].gate}</span>
            <span className={styles.gateStatus}>{status}</span>
        </div>
    );
}

const header = <div style={{ fontSize: '15px', fontWeight: 600 }}>Decision flow</div>;

/**
 * Developer-only decision-flow pipeline for the v3 struggle engine. Reads the latest tick's
 * {@link LiveDecisionTrace} off the init snapshot (the SAME trace the live feed emits) and shows
 * the EDIT path as five stages in the engine's REAL evaluation order (alertStateMachine Step 2,
 * same order as the thesis pipeline figure): Candidate → Gates (B2/B4/D1) → Severity →
 * Cooldown/re-arm → Outcome. Stages left of the recorded blocker were actually passed this tick
 * (green); the blocker is red; stages right of it were not reached (neutral — the Severity box
 * still states its live condition in the sub-label, without claiming it was evaluated). The
 * discrete add-on (test-stagnation) fires on its own path and is shown as a separate verdict,
 * never as a faked all-pass flow.
 */
export function DecisionFlowPipeline({ debug, collapsible, defaultCollapsed }: DecisionFlowPipelineProps) {
    const { cooldownLeft, warmupLeft, graceLeft } = useEngineCountdowns(debug);
    const trace = debug.decisionTrace;

    // Render only with an active session AND a real tick — the snapshot anchors are stale otherwise
    // (`_lastTick` persists across sessions), so the engine nulls the trace when inactive.
    if (!debug.sessionActive || !trace) {
        return null;
    }

    // Discrete add-on (test-stagnation): own decision path, bypasses severity/candidate/gates and
    // is subject only to the cooldown. Show a distinct verdict instead of a fake edit-path flow.
    if (trace.outcome === 'fired-discrete' && trace.discreteTrigger) {
        return (
            <Container header={header} variant="default" padding="default" collapsible={collapsible} defaultCollapsed={defaultCollapsed}>
                <div className={styles.panel}>
                    <div className={styles.verdict} style={{ borderTop: 'none', paddingTop: 0 }}>
                        <Badge variant="error">Alert fired</Badge>
                        <span className={styles.verdictText}>{discreteText(trace.discreteTrigger)}</span>
                    </div>
                    <p className={styles.note}>
                        Fired on the discrete test-stagnation path (separate from the edit pipeline; only
                        the cooldown applies).
                    </p>
                </div>
            </Container>
        );
    }

    const { reason } = trace;
    const fired = trace.outcome === 'fired-edit';

    // The engine short-circuits in a fixed order (see STAGE_OF_REASON), so stage status is exact:
    // everything before the recorded reason was evaluated and passed, the reason's stage is the
    // blocker, everything after it was not reached. A not-reached Severity box still states its
    // live condition ("over/below threshold") in the sub-label, but stays neutral — it must not
    // claim the engine checked it (a fired tick marks all four checks as passed).
    const reasonStage = STAGE_OF_REASON[reason];
    const statusOf = (stage: number): StageStatus =>
        reasonStage > stage ? 'pass' : reasonStage === stage ? 'block' : 'neutral';

    const sevOk = trace.urgency >= trace.theta;
    const candOk = trace.boundariesPresent.length > 0;

    const gateBlockSub = (): string => {
        if (reason === 'cooldown') { return `blocking · ${cooldownLeft !== null ? mmss(cooldownLeft) : '—'} left`; }
        if (reason === 'd1-warmup') { return `blocking · ${mmss(warmupLeft)} left`; }
        if (reason === 'b4-grace-filter') { return `blocking · ${graceLeft !== null ? `${Math.ceil(graceLeft)}s` : '—'} left`; }
        return 'blocking';
    };

    const gatesStatus = statusOf(1);
    const historyStatus = statusOf(3);

    const stages: Stage[] = [
        {
            name: 'Candidate',
            status: statusOf(0),
            value: candOk ? boundaryShort(trace.boundariesPresent[0]) : 'none',
            sub: candOk ? 'boundary present' : 'no boundary',
        },
        {
            name: 'Gates',
            status: gatesStatus,
            value: gatesStatus === 'block' ? (STAGE_BLOCK_LABEL[reason] ?? 'gate') : gatesStatus === 'pass' ? 'passed' : '—',
            sub: gatesStatus === 'block' ? gateBlockSub() : '',
        },
        {
            name: 'Severity',
            status: statusOf(2),
            value: trace.urgency.toFixed(2),
            sub: sevOk ? 'over threshold' : 'below threshold',
        },
        {
            name: 'Cooldown',
            status: historyStatus,
            value: historyStatus === 'block' ? (STAGE_BLOCK_LABEL[reason] ?? 'gate') : historyStatus === 'pass' ? 'passed' : '—',
            sub: historyStatus === 'block' ? gateBlockSub() : '',
        },
        {
            name: 'Outcome',
            // The edit path's DECISION; delivery is downstream (coordinator gate, backoff, throttle
            // caps) and may still drop it, so this never claims the nudge was actually sent.
            status: fired ? 'pass' : 'neutral',
            value: fired ? 'Alert fired' : 'Holding back',
            sub: fired ? 'alert raised' : 'no nudge',
        },
    ];

    return (
        <Container header={header} variant="default" padding="default" collapsible={collapsible} defaultCollapsed={defaultCollapsed}>
            <div className={styles.panel}>
                <p className={styles.note}>
                    How the latest 10&nbsp;s tick decided &quot;nudge or not&quot; (edit path), in the order
                    the engine checks. Green stages were passed this tick, the red stage stopped it,
                    grey stages were not reached.
                </p>

                <div className={styles.pipe}>
                    {stages.map((s, i) => (
                        <Fragment key={s.name}>
                            {i > 0 && <span className={styles.arrow}>→</span>}
                            <div className={`${styles.stage} ${stageClass(s.status)}`} data-status={s.status}>
                                <div className={styles.stageName}>{i + 1} · {s.name}</div>
                                <div className={styles.stageValue}>{s.value}</div>
                                {s.sub && <div className={styles.stageSub}>{s.sub}</div>}
                            </div>
                        </Fragment>
                    ))}
                </div>

                <div className={styles.verdict}>
                    <Badge variant={fired ? 'error' : 'muted'}>{fired ? 'Alert fired' : 'Holding back'}</Badge>
                    <span className={styles.verdictText}>{reasonText(reason)}</span>
                </div>

                <div className={styles.group}>
                    <div className={styles.groupTitle}>Detector gates this tick</div>
                    <p className={styles.gatesNote}>
                        Live condition of each detector gate (the urgency threshold is its own stage above).
                        &quot;blocking&quot; is the gate that actually held this tick back; &quot;engaged&quot; means
                        its condition holds but the flow already stopped at an earlier stage.
                    </p>
                    <div className={styles.gateGroupTitle}>Reads the student&apos;s moment (stage 2)</div>
                    {MOMENT_GATES.map((g) => renderGate(g, trace, reason))}
                    <div className={styles.gateGroupTitle}>Reads the engine&apos;s history (stage 4)</div>
                    {HISTORY_GATES.map((g) => renderGate(g, trace, reason))}
                </div>
            </div>
        </Container>
    );
}
