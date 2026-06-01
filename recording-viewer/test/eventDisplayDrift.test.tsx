import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventSummary, eventDetail } from '../src/utils/eventDisplay';

// #243: the event-stream detail row (eventDetail) and the timeline tooltip
// (eventSummary) had drifted on a handful of fields. The differences below were
// classified as accidental and harmonized so the tooltip surfaces the same
// information as the detail row. Each test asserts both views surface the
// harmonized field (and, where the field is conditional, that it's omitted when
// it should be). This guards the specific fields fixed here against re-drift; it
// is not a full-string equality check — the two views intentionally differ in
// styling and verbosity.

const detailText = (e: RecordedEvent) => render(<>{eventDetail(e)}</>).container.textContent ?? '';
const summaryText = (e: RecordedEvent) => render(<>{eventSummary(e, 0)}</>).container.textContent ?? '';

describe('eventDisplay drift harmonization (#243)', () => {
    it('intervention: both views uppercase the action and separate level from EQ with a pipe', () => {
        const e: RecordedEvent = {
            type: 'intervention', timestamp: 1000, action: 'dismissed', level: 'notification',
            shouldIntervene: true, eq: 0.42, confidence: 'sufficient', triggerType: 'idle',
        };
        for (const text of [detailText(e), summaryText(e)]) {
            expect(text).toContain('DISMISSED');
            expect(text).toContain('notification | EQ:');
        }
    });

    it('eqEngineState: both views show the confidence', () => {
        const e: RecordedEvent = {
            type: 'eqEngineState', timestamp: 1000, snapshots: [], currentEQ: 0.5,
            pairCount: 3, confidence: 'sufficient',
        };
        expect(detailText(e)).toContain('sufficient');
        expect(summaryText(e)).toContain('sufficient');
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
});
