import { useEffect, useState } from 'react';

import type { SlotDebugSnapshot, VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';

import { Container } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './SlotPanel.module.css';
import { mmss } from './useEngineCountdowns';
import { useSlotCountdowns } from './useSlotCountdowns';

// ---------------------------------------------------------------------------
// Inner component - always receives a non-null snapshot, so hooks are called
// unconditionally (satisfying Rules of Hooks).
// ---------------------------------------------------------------------------

/**
 * The "why is it silent" block: session latches, student toggle, and the idle-abandon evidence
 * gate. Rendered in BOTH the free and occupied branches — the free state is exactly when these matter.
 */
function SuppressionStatus({ snapshot }: { snapshot: SlotDebugSnapshot }) {
    const s = snapshot.suppression;
    return (
        <div className={styles.group}>
            <div className={styles.groupTitle}>Suppression status</div>
            <div className={styles.row}>
                <span className={styles.label}>Evidence gate (idle-abandon)</span>
                <span className={styles.value}>{snapshot.awaitingEvidence ? 'awaiting fresh evidence' : 'clear'}</span>
            </div>
            <div className={styles.row}>
                <span className={styles.label}>Server</span>
                <span className={styles.value}>{s.serverAvailable ? 'available' : 'unavailable (local fallback)'}</span>
            </div>
            <div className={styles.row}>
                <span className={styles.label}>Course proactive</span>
                <span className={styles.value}>{s.courseProactiveOff ? 'latched off' : 'on'}</span>
            </div>
            <div className={styles.row}>
                <span className={styles.label}>Student toggle</span>
                <span className={styles.value}>{s.studentProactiveOn ? 'on' : 'off'}</span>
            </div>
        </div>
    );
}

function SlotPanelBody({ snapshot }: { snapshot: SlotDebugSnapshot }) {
    const { staleLeft } = useSlotCountdowns(snapshot);

    const badgeClass =
        snapshot.state === 'free'
            ? styles.badgeFree
            : snapshot.state === 'parked'
                ? styles.badgeParked
                : styles.badgeDelivered;

    return (
        <div className={styles.panel}>
            <div className={styles.badgeRow}>
                <span className={`${styles.badge} ${badgeClass}`}>
                    {snapshot.state.toUpperCase()}
                </span>
            </div>

            {snapshot.state === 'free' && (
                <>
                    <p className={styles.emptyState}>Slot free - no active intervention.</p>
                    <SuppressionStatus snapshot={snapshot} />
                </>
            )}

            {snapshot.state !== 'free' && (
                <>
                    <div className={styles.group}>
                        <div className={styles.groupTitle}>Episode</div>
                        <div className={styles.row}>
                            <span className={styles.label}>Episode ID</span>
                            <span className={styles.value}>{snapshot.episodeId ?? 'none'}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Generation</span>
                            <span className={styles.value}>{snapshot.generation}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Episode age</span>
                            <span className={styles.value}>
                                {snapshot.episodeAgeMs !== null
                                    ? mmss(snapshot.episodeAgeMs / 1000, 'floor')
                                    : <span className={styles.muted}>n/a</span>}
                            </span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Level</span>
                            <span className={styles.value}>{snapshot.level ?? 'none'}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Hint count</span>
                            <span className={styles.value}>{snapshot.hintCount}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Is new</span>
                            <span className={styles.value}>{snapshot.isNew ? 'yes' : 'no'}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>In session</span>
                            <span className={styles.value}>{snapshot.inSession ? 'yes' : 'no'}</span>
                        </div>
                    </div>

                    <div className={styles.group}>
                        <div className={styles.groupTitle}>Watchdog</div>
                        <div className={styles.row}>
                            <span className={styles.label}>Armed</span>
                            <span className={styles.value}>{snapshot.watchdog.armed ? 'yes' : 'no'}</span>
                        </div>
                        {snapshot.watchdog.armed && (
                            <div className={styles.row}>
                                <span className={styles.label}>Idle-free in</span>
                                <span className={styles.value}>{mmss(staleLeft ?? 0)}</span>
                            </div>
                        )}
                    </div>

                    {snapshot.inFlight !== null && (
                        <div className={styles.group}>
                            <div className={styles.groupTitle}>In-flight request</div>
                            <div className={styles.row}>
                                <span className={styles.label}>Intent</span>
                                <span className={styles.value}>{snapshot.inFlight.intent}</span>
                            </div>
                            <div className={styles.row}>
                                <span className={styles.label}>Local token</span>
                                <span className={styles.value}>{snapshot.inFlight.localToken}</span>
                            </div>
                            <div className={styles.row}>
                                <span className={styles.label}>Episode:generation</span>
                                <span className={styles.value}>{snapshot.inFlight.episodeId}:{snapshot.inFlight.generation}</span>
                            </div>
                            <div className={styles.row}>
                                <span className={styles.label}>Request token (first 8)</span>
                                <span className={styles.value}>{snapshot.inFlight.requestToken.slice(0, 8)}</span>
                            </div>
                        </div>
                    )}

                    <div className={styles.group}>
                        <div className={styles.groupTitle}>Owed and pending</div>
                        <div className={styles.row}>
                            <span className={styles.label}>Confirm close owed</span>
                            <span className={styles.value}>{snapshot.owed.confirmClose ? 'yes' : 'no'}</span>
                        </div>
                        <div className={styles.row}>
                            <span className={styles.label}>Pending outcomes</span>
                            <span className={styles.value}>{snapshot.pendingOutcomes}</span>
                        </div>
                    </div>

                    <SuppressionStatus snapshot={snapshot} />
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Exported outer component - owns subscribe lifecycle and null-guard for snapshot.
// ---------------------------------------------------------------------------

/**
 * Developer-only panel showing live slot state for the v3 proactivity pipeline.
 * Subscribes to struggleLiveSubscribe on mount, and renders per-second countdown
 * interpolation via useSlotCountdowns once the first snapshot arrives.
 *
 * Rules of Hooks: useSlotCountdowns calls hooks internally, so it must not be
 * called conditionally. The SlotPanel/SlotPanelBody split ensures SlotPanelBody
 * (which calls the hook) only renders once snapshot is non-null.
 */
export function SlotPanel({ vscodeApi, collapsible, defaultCollapsed }: { vscodeApi: VsCodeApi; collapsible?: boolean; defaultCollapsed?: boolean }) {
    const [snapshot, setSnapshot] = useState<SlotDebugSnapshot | null>(null);

    // 1) Register the message listener FIRST so it is live before we subscribe.
    useExtensionMessage((msg) => {
        if (msg.type === ExtensionMsg.StruggleSlotUpdate) {
            setSnapshot(msg.snapshot);
        }
    }, [setSnapshot]);

    // 2) Subscribe on mount / unsubscribe on unmount. Runs after the listener is
    //    set up (effects fire in declaration order), so no slot update is lost.
    useEffect(() => {
        postCommand(vscodeApi, 'struggleLiveSubscribe');
        return () => postCommand(vscodeApi, 'struggleLiveUnsubscribe');
    }, [vscodeApi]);

    return (
        <Container
            header={<div style={{ fontSize: '15px', fontWeight: 600 }}>Slot (live)</div>}
            variant="default"
            padding="default"
            collapsible={collapsible}
            defaultCollapsed={defaultCollapsed}
        >
            {snapshot === null ? (
                <p className={styles.waiting}>Waiting for slot data.</p>
            ) : (
                <SlotPanelBody snapshot={snapshot} />
            )}
        </Container>
    );
}
