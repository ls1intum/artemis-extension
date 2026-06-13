import type { RecordedEvent } from '@extension/services/recording/types';
import { SPEC } from '@extension/services/struggle/constants';

import type { GoldenSession } from './goldenTypes';

/**
 * Asserts that the golden was generated with the frozen engine constants.
 * A golden built with different theta or graceS is incomparable to the TS engine.
 */
export function assertSpecConstants(g: GoldenSession): void {
    if (g.theta !== SPEC.THETA_FULL) {
        throw new Error(
            `invariant: golden theta ${g.theta} !== SPEC.THETA_FULL ${SPEC.THETA_FULL}. ` +
            'Golden was generated with different constants and is incomparable.'
        );
    }
    // grace_s comes from the F3 derivation as a full-precision double
    // (32.940000000000055); the TS SPEC froze the human value 32.94. The ~5e-14
    // gap never flips grace gating at the 10s tick / event-time granularities,
    // so tolerate float noise here rather than reject every golden. A real
    // constant mismatch (different derived value) is orders of magnitude larger.
    const GRACE_TOL = 1e-9;
    if (Math.abs(g.graceS - SPEC.GRACE_S) > GRACE_TOL) {
        throw new Error(
            `invariant: golden graceS ${g.graceS} differs from SPEC.GRACE_S ${SPEC.GRACE_S} ` +
            `by more than ${GRACE_TOL}. Golden was generated with different constants and is incomparable.`
        );
    }
}

/**
 * Scans taskFeedbackView events and throws if a 'closed' event is encountered
 * for a viewId with no prior 'opened' (or that was already closed).
 * Mirrors engine_v2.py behaviour which raises on close-without-open.
 */
export function assertFeedbackViewMatched(events: readonly RecordedEvent[]): void {
    const openViewIds = new Set<string>();
    for (const event of events) {
        if (event.type !== 'taskFeedbackView') {
            continue;
        }
        if (event.action === 'opened') {
            openViewIds.add(event.viewId);
        } else {
            // action === 'closed'
            if (!openViewIds.has(event.viewId)) {
                throw new Error(
                    `invariant: taskFeedbackView 'closed' for viewId "${event.viewId}" ` +
                    'at timestamp ' + event.timestamp + ' has no prior opened event. ' +
                    'Close-without-open indicates a corrupt or truncated event stream.'
                );
            }
            openViewIds.delete(event.viewId);
        }
    }
}

/**
 * Asserts that every URI with a textChange also has a fileSnapshot somewhere in
 * the stream. A fileSnapshot is REQUIRED (a textDocumentOpen carries no text, so
 * the replay would reconstruct against an empty document and silently mis-derive
 * causal A8). Membership — not stream order — is the contract: the recorder
 * writes a snapshot's event only after async I/O, so it can legitimately land
 * after an early edit, and the replay hub pre-seeds FileTextState from ALL
 * fileSnapshots up front regardless of position.
 */
export function assertEveryChangeHasSnapshot(events: readonly RecordedEvent[]): void {
    const snapshotUris = new Set<string>();
    for (const event of events) {
        if (event.type === 'fileSnapshot') {
            snapshotUris.add(event.uri);
        }
    }
    for (const event of events) {
        if (event.type === 'textChange' && !snapshotUris.has(event.uri)) {
            throw new Error(
                `invariant: textChange for URI "${event.uri}" at timestamp ${event.timestamp} ` +
                'has no fileSnapshot in the stream; the replay cannot reconstruct its baseline text.'
            );
        }
    }
}
