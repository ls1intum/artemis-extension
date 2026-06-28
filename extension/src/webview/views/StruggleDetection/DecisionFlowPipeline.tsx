import { Fragment } from 'react';

import type { BoundaryType, LiveDecisionTrace, StruggleDebugSnapshot } from '@shared/messageContracts';

import { Badge, Container } from '@webview/components';

import styles from './DecisionFlowPipeline.module.css';
import type { EditTraceReason } from './glossary';
import { discreteText, GLOSSARY, reasonText } from './glossary';
import { mmss, useEngineCountdowns } from './useEngineCountdowns';

interface DecisionFlowPipelineProps {
    debug: StruggleDebugSnapshot;
}

/**
 * The five delivery gates in engine evaluation order, paired with their live flag. The urgency
 * threshold (`below-threshold`) is deliberately NOT listed here: it is the Severity stage above,
 * so listing it again would double-represent it (and contradict the neutral Gates stage box).
 */
const GATES: { reason: EditTraceReason; flag: keyof LiveDecisionTrace['gates'] }[] = [
    { reason: 'b2-fluent-typing', flag: 'fluentTyping' },
    { reason: 'b4-grace-filter', flag: 'grace' },
    { reason: 'd1-warmup', flag: 'warmup' },
    { reason: 'cooldown', flag: 'cooldown' },
    { reason: 'not-rearmed', flag: 'notRearmed' },
];

/** The gate reasons that mark a stage-3 (Gates) block, derived from GATES so the two never drift. */
const GATE_REASONS: EditTraceReason[] = GATES.map((g) => g.reason);

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

const header = <div style={{ fontSize: '15px', fontWeight: 600 }}>Decision flow</div>;

/**
 * Developer-only decision-flow pipeline for the v3 struggle engine. Reads the latest tick's
 * {@link LiveDecisionTrace} off the init snapshot (the SAME trace the live feed emits) and shows
 * the EDIT path as four stages: Severity → Candidate → Gates → Outcome, with the blocking stage
 * highlighted. The discrete add-on (test-stagnation) fires on its own path and is shown as a
 * separate verdict, never as a faked all-pass flow.
 */
export function DecisionFlowPipeline({ debug }: DecisionFlowPipelineProps) {
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
            <Container header={header} variant="default" padding="default">
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

    // Each stage shows its OWN factual condition; the engine's recorded `reason` marks the decisive
    // blocker (red). The engine short-circuits in the order candidate → B2 → B4 → D1(warm-up) →
    // below-threshold → cooldown → re-arm (see alertStateMachine); the four pipeline stages are a
    // conceptual grouping of that order, not the literal sequence. So a stage can be factually
    // "not ok" without being the recorded reason — e.g. urgency below θ while the reason is "no
    // boundary". Such a stage is shown neutral (its sub-label still states the true condition),
    // NOT green and NOT the red blocker.
    const sevOk = trace.urgency >= trace.theta;
    const candOk = trace.boundariesPresent.length > 0;
    const sevStatus: StageStatus = reason === 'below-threshold' ? 'block' : sevOk ? 'pass' : 'neutral';
    const candStatus: StageStatus = reason === 'no-candidate' ? 'block' : candOk ? 'pass' : 'neutral';
    const gateBlocked = GATE_REASONS.includes(reason);
    const gatesStatus: StageStatus = gateBlocked ? 'block' : reason === 'fired' ? 'pass' : 'neutral';

    const gateBlockSub = (): string => {
        if (reason === 'cooldown') { return `blocking · ${cooldownLeft !== null ? mmss(cooldownLeft) : '—'} left`; }
        if (reason === 'd1-warmup') { return `blocking · ${mmss(warmupLeft)} left`; }
        if (reason === 'b4-grace-filter') { return `blocking · ${graceLeft !== null ? `${Math.ceil(graceLeft)}s` : '—'} left`; }
        return 'blocking';
    };

    const stages: Stage[] = [
        {
            name: 'Severity',
            status: sevStatus,
            value: trace.urgency.toFixed(2),
            sub: sevOk ? 'over threshold' : 'below threshold',
        },
        {
            name: 'Candidate',
            status: candStatus,
            value: candOk ? boundaryShort(trace.boundariesPresent[0]) : 'none',
            sub: candOk ? 'boundary present' : 'no boundary',
        },
        {
            name: 'Gates',
            status: gatesStatus,
            value: gatesStatus === 'block' ? (GLOSSARY[reason].gate ?? 'gate') : gatesStatus === 'pass' ? 'all clear' : '—',
            sub: gatesStatus === 'block' ? gateBlockSub() : '',
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
        <Container header={header} variant="default" padding="default">
            <div className={styles.panel}>
                <p className={styles.note}>
                    How the latest 10&nbsp;s tick got from severity to &quot;nudge or not&quot; (edit path).
                </p>

                <div className={styles.pipe}>
                    {stages.map((s, i) => (
                        <Fragment key={s.name}>
                            {i > 0 && <span className={styles.arrow}>→</span>}
                            <div className={`${styles.stage} ${stageClass(s.status)}`}>
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
                    <div className={styles.groupTitle}>Delivery gates this tick</div>
                    <p className={styles.gatesNote}>
                        Live condition of each delivery gate (the urgency threshold is shown above as Severity).
                        &quot;blocking&quot; is the gate that actually held this tick back; &quot;engaged&quot; means
                        its condition holds but the flow already stopped at an earlier stage.
                    </p>
                    {GATES.map(({ reason: r, flag }) => {
                        // A gate only counts as the blocker when it is the engine's recorded decision reason;
                        // otherwise an active condition (e.g. warm-up while there is no boundary) is just "engaged".
                        // On a FIRED tick the flow stopped nowhere, so a still-true warm-up/grace flag (FM/E4
                        // broke through warm-up, FM/FM+ survived the grace filter) is NOT "engaged" — it is clear.
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
                    })}
                </div>
            </div>
        </Container>
    );
}
