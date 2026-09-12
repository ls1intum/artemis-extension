import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';

import type { SlotDebugSnapshot, VsCodeApi } from '@shared/messageContracts';
import { ExtensionMsg, postCommand } from '@shared/messageContracts';
import { mmss } from '@shared/utils/mmss';

import { Container } from '@webview/components';
import { useExtensionMessage } from '@webview/hooks/useExtensionMessage';

import styles from './SlotPanel.module.css';
import { useSlotCountdowns } from './useSlotCountdowns';

/** One label/value line. Every field in this panel is one of these. */
function Row({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className={styles.row}>
            <span className={styles.label}>{label}</span>
            <span className={styles.value}>{children}</span>
        </div>
    );
}

/**
 * The "why is it silent" block: session latches, student toggle, and the idle-abandon evidence
 * gate. Rendered in BOTH the free and occupied branches, since the free state is exactly when
 * these matter.
 */
function SuppressionStatus({ snapshot }: { snapshot: SlotDebugSnapshot }) {
    const s = snapshot.suppression;
    return (
        <div className={styles.group}>
            <div className={styles.groupTitle}>Suppression status</div>
            <Row label="Evidence gate (idle-abandon)">{snapshot.awaitingEvidence ? 'awaiting fresh evidence' : 'clear'}</Row>
            <Row label="Server">{s.serverAvailable ? 'available' : 'unavailable (local fallback)'}</Row>
            <Row label="Course proactive">{s.courseProactiveOff ? 'latched off' : 'on'}</Row>
            <Row label="Student toggle">{s.studentProactiveOn ? 'on' : 'off'}</Row>
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
                        <Row label="Episode ID">{snapshot.episodeId ?? 'none'}</Row>
                        <Row label="Generation">{snapshot.generation}</Row>
                        <Row label="Episode age">
                            {snapshot.episodeAgeMs !== null
                                ? mmss(snapshot.episodeAgeMs / 1000, 'floor')
                                : <span className={styles.muted}>n/a</span>}
                        </Row>
                        <Row label="Level">{snapshot.level ?? 'none'}</Row>
                        <Row label="Hint count">{snapshot.hintCount}</Row>
                        <Row label="Is new">{snapshot.isNew ? 'yes' : 'no'}</Row>
                        <Row label="In session">{snapshot.inSession ? 'yes' : 'no'}</Row>
                    </div>

                    <div className={styles.group}>
                        <div className={styles.groupTitle}>Watchdog</div>
                        <Row label="Armed">{snapshot.watchdog.armed ? 'yes' : 'no'}</Row>
                        {snapshot.watchdog.armed && <Row label="Idle-free in">{mmss(staleLeft ?? 0)}</Row>}
                    </div>

                    {snapshot.inFlight !== null && (
                        <div className={styles.group}>
                            <div className={styles.groupTitle}>In-flight request</div>
                            <Row label="Intent">{snapshot.inFlight.intent}</Row>
                            <Row label="Local token">{snapshot.inFlight.localToken}</Row>
                            <Row label="Episode:generation">{snapshot.inFlight.episodeId}:{snapshot.inFlight.generation}</Row>
                            <Row label="Request token (first 8)">{snapshot.inFlight.requestToken.slice(0, 8)}</Row>
                        </div>
                    )}

                    <div className={styles.group}>
                        <div className={styles.groupTitle}>Owed and pending</div>
                        <Row label="Confirm close owed">{snapshot.owed.confirmClose ? 'yes' : 'no'}</Row>
                        <Row label="Pending outcomes">{snapshot.pendingOutcomes}</Row>
                    </div>

                    <SuppressionStatus snapshot={snapshot} />
                </>
            )}
        </div>
    );
}

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
