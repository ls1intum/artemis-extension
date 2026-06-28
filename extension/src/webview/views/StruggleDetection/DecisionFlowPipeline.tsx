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

/** The six decision gates in engine evaluation order, paired with their live flag. */
const GATES: { reason: EditTraceReason; flag: keyof LiveDecisionTrace['gates'] }[] = [
    { reason: 'b2-fluent-typing', flag: 'fluentTyping' },
    { reason: 'b4-grace-filter', flag: 'grace' },
    { reason: 'd1-warmup', flag: 'warmup' },
    { reason: 'below-threshold', flag: 'belowThreshold' },
    { reason: 'cooldown', flag: 'cooldown' },
    { reason: 'not-rearmed', flag: 'notRearmed' },
];

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
    // Which stage stops the flow: 0=Severity, 1=Candidate, 2=Gates, 3=none (fired through).
    const stopIdx = reason === 'below-threshold' ? 0
        : reason === 'no-candidate' ? 1
            : reason === 'fired' ? 3
                : 2;
    const statusOf = (i: number): StageStatus => (i < stopIdx ? 'pass' : i === stopIdx ? 'block' : 'neutral');

    const gateBlockSub = (): string => {
        if (reason === 'cooldown') { return `blocking · ${cooldownLeft !== null ? mmss(cooldownLeft) : '—'} left`; }
        if (reason === 'd1-warmup') { return `blocking · ${mmss(warmupLeft)} left`; }
        if (reason === 'b4-grace-filter') { return `blocking · ${graceLeft !== null ? `${Math.ceil(graceLeft)}s` : '—'} left`; }
        return 'blocking';
    };

    const gatesStatus = statusOf(2);
    const stages: Stage[] = [
        {
            name: 'Severity',
            status: statusOf(0),
            value: trace.urgency.toFixed(2),
            sub: statusOf(0) === 'block' ? 'below threshold' : 'over threshold',
        },
        {
            name: 'Candidate',
            status: statusOf(1),
            value: boundaryShort(trace.boundariesPresent[0]),
            sub: statusOf(1) === 'block' ? 'no boundary' : statusOf(1) === 'pass' ? 'boundary present' : '',
        },
        {
            name: 'Gates',
            status: gatesStatus,
            value: gatesStatus === 'block' ? (GLOSSARY[reason].gate ?? 'gate') : gatesStatus === 'pass' ? 'all clear' : '—',
            sub: gatesStatus === 'block' ? gateBlockSub() : '',
        },
        {
            name: 'Outcome',
            status: fired ? 'pass' : 'neutral',
            value: fired ? 'Alert fired' : 'Holding back',
            sub: fired ? 'nudge sent' : 'no nudge',
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
                    <div className={styles.groupTitle}>All gates this tick</div>
                    {GATES.map(({ reason: r, flag }) => {
                        const engaged = trace.gates[flag];
                        return (
                            <div key={flag} className={`${styles.gate} ${engaged ? styles.gateOn : ''}`} title={GLOSSARY[r].tooltip}>
                                <span className={styles.gateDot} />
                                <span className={styles.gateName}>{GLOSSARY[r].gate}</span>
                                <span className={styles.gateStatus}>{engaged ? 'engaged' : 'clear'}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </Container>
    );
}
