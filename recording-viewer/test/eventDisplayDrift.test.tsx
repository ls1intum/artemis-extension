import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventSummary, eventDetail } from '../src/utils/eventDisplay';

// The event-stream detail row (eventDetail) and the timeline tooltip
// (eventSummary) must surface the same information for the fields below, and
// omit the conditional ones together. This is not a full-string equality
// check: the two views intentionally differ in styling and verbosity.

const detailText = (e: RecordedEvent) => render(<>{eventDetail(e)}</>).container.textContent ?? '';
const summaryText = (e: RecordedEvent) => render(<>{eventSummary(e, 0)}</>).container.textContent ?? '';

/**
 * `intervention` and `eqEngineState` were retired from the canonical schema
 * (EQ engine removal, commit 87fd6578, synced into the generated types by
 * 36fbe503) and are no longer part of `RecordedEvent`. Old recordings on disk
 * still contain rows of these shapes, and `eventDetail`/`eventSummary` still
 * render them (see the legacy branches in eventDisplay.tsx), so these two
 * tests keep exercising that path via a viewer-local legacy shape + cast,
 * mirroring eventDisplay.tsx's own LegacyInterventionEvent/
 * LegacyEqEngineStateEvent.
 */
interface LegacyInterventionEvent {
    type: 'intervention';
    timestamp: number;
    action: string;
    level: string;
    shouldIntervene: boolean;
    eq: number;
    confidence: 'sufficient' | 'insufficient';
    triggerType?: string;
}
interface LegacyEqEngineStateEvent {
    type: 'eqEngineState';
    timestamp: number;
    snapshots: unknown[];
    currentEQ: number;
    pairCount: number;
    confidence: 'sufficient' | 'insufficient';
}

describe('eventDisplay drift harmonization (#243)', () => {
    it('intervention: both views uppercase the action and separate level from EQ with a pipe', () => {
        const e: LegacyInterventionEvent = {
            type: 'intervention', timestamp: 1000, action: 'dismissed', level: 'notification',
            shouldIntervene: true, eq: 0.42, confidence: 'sufficient', triggerType: 'idle',
        };
        const event = e as unknown as RecordedEvent;
        for (const text of [detailText(event), summaryText(event)]) {
            expect(text).toContain('DISMISSED');
            expect(text).toContain('notification | EQ:');
        }
    });

    it('eqEngineState: both views show the confidence', () => {
        const e: LegacyEqEngineStateEvent = {
            type: 'eqEngineState', timestamp: 1000, snapshots: [], currentEQ: 0.5,
            pairCount: 3, confidence: 'sufficient',
        };
        const event = e as unknown as RecordedEvent;
        expect(detailText(event)).toContain('sufficient');
        expect(summaryText(event)).toContain('sufficient');
    });

    it('buildResult: both views show the failed-test count', () => {
        const e: RecordedEvent = {
            type: 'buildResult', timestamp: 1000, successful: false, errorCount: 0,
            failedTests: ['t1', 't2'], buildFailed: false,
        };
        expect(detailText(e)).toContain('2 test(s) failed');
        expect(summaryText(e)).toContain('2 test(s) failed');
    });

    it('buildResult: neither view shows a failed-test count when there are none', () => {
        const e: RecordedEvent = {
            type: 'buildResult', timestamp: 1000, successful: true, errorCount: 0,
            failedTests: [], buildFailed: false,
        };
        expect(detailText(e)).not.toContain('test(s) failed');
        expect(summaryText(e)).not.toContain('test(s) failed');
    });

    it('terminalCommand: both views show duration and the truncated flag', () => {
        const e: RecordedEvent = {
            type: 'terminalCommand', timestamp: 1000, command: 'gradle test', exitCode: 1,
            output: 'x', outputTruncated: true, cwd: '/w', terminalName: 'bash', durationMs: 3000,
        };
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('(3s)');
            expect(text).toContain('[truncated]');
        }
    });

    it('terminalCommand: neither view shows the truncated flag when output is whole', () => {
        const e: RecordedEvent = {
            type: 'terminalCommand', timestamp: 1000, command: 'ls', exitCode: 0,
            output: 'x', outputTruncated: false, cwd: '/w', terminalName: 'bash', durationMs: 1000,
        };
        expect(detailText(e)).not.toContain('[truncated]');
        expect(summaryText(e)).not.toContain('[truncated]');
    });

    it('selectionChange: both views show line and column', () => {
        const e: RecordedEvent = {
            type: 'selectionChange', timestamp: 1000, uri: 'file:///w/Main.java',
            selections: [{ startLine: 9, startCharacter: 4, endLine: 9, endCharacter: 10 }],
            kind: 'mouse',
        };
        expect(detailText(e)).toContain('L9:4');
        expect(summaryText(e)).toContain('L9:4');
    });

    it('submission: both views show the commit message', () => {
        const e: RecordedEvent = {
            type: 'submission', timestamp: 1000, status: 'started', participationId: 42,
            commitMessage: 'fix off-by-one',
        };
        expect(detailText(e)).toContain('fix off-by-one');
        expect(summaryText(e)).toContain('fix off-by-one');
    });

    it('problemStatementScroll: both views show page percent and statement visibility', () => {
        const e: RecordedEvent = {
            type: 'problemStatementScroll', timestamp: 1000,
            scrollTop: 1100, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 900, statementHeight: 1600,
        };
        // page: 1100 / (3000-800) = 50%; visible: (1100-900)/1600=12.5%→13 to (1100+800-900)/1600=62.5%→63
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('50%');
            expect(text).toContain('statement 13–63% visible');
        }
    });

    it('problemStatementScroll: both views say "not visible" when the statement is off-screen', () => {
        const e: RecordedEvent = {
            type: 'problemStatementScroll', timestamp: 1000,
            scrollTop: 0, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 900, statementHeight: 1600,
        };
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('statement not visible');
        }
    });

    it('problemStatementScroll: page percent is clamped on rubber-band overscroll', () => {
        const e: RecordedEvent = {
            type: 'problemStatementScroll', timestamp: 1000,
            scrollTop: 2500, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 900, statementHeight: 1600,
        };
        // 2500 / 2200 would be 114% unclamped
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('100%');
            expect(text).not.toContain('114%');
        }
    });

    it('problemStatementSelection: both views show the text preview and length', () => {
        const e: RecordedEvent = {
            type: 'problemStatementSelection', timestamp: 1000,
            selectedText: 'implement the constructor', selectionLength: 25, truncated: false,
            selectionTop: 1200, selectionLeft: 40, selectionWidth: 320, selectionHeight: 18,
        };
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('implement the constructor');
            expect(text).toContain('25 chars');
        }
    });

    it('problemStatementSelection: long selections are previewed with an ellipsis', () => {
        const e: RecordedEvent = {
            type: 'problemStatementSelection', timestamp: 1000,
            selectedText: 'z'.repeat(500), selectionLength: 800, truncated: true,
            selectionTop: 0, selectionLeft: 0, selectionWidth: 10, selectionHeight: 10,
        };
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('…');
            expect(text).toContain('800 chars');
        }
    });
});
