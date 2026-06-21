/**
 * Unit tests for parseRecordedEvent + parseSessionMetadata (#183).
 *
 * The recording replay path reads untrusted on-disk data (metadata.json,
 * events.jsonl). Pre-fix it was cast directly to the typed shape, masking
 * schema drift. The validators are strict per-variant on RecordedEvent so
 * adding a new event type requires touching both the type declaration and
 * the parser case (deliberate review affordance).
 *
 * Test strategy:
 *   - Happy-path roundtrip per variant: build an object literal that matches
 *     the declared type, parse it, assert deep-equal back.
 *   - Reject malformed input at the dispatcher level (non-object, wrong
 *     `type`, missing `timestamp`).
 *   - Reject malformed input at the per-variant level for each shape that
 *     has a "tricky" required field (literal unions, secondary discriminator
 *     on view events, nested arrays, etc.).
 */

import * as assert from 'assert';

import { KNOWN_EVENT_TYPES, parseRecordedEvent, parseSessionMetadata } from '@extension/services/recording/parseRecordedData';
import type { RecordedEvent, SessionMetadata } from '@extension/services/recording/types';

const ts = 1700000000000;

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

suite('parseRecordedEvent — dispatcher-level rejection', () => {
    test('null returns null', () => {
        assert.strictEqual(parseRecordedEvent(null), null);
    });
    test('array returns null', () => {
        assert.strictEqual(parseRecordedEvent([1, 2, 3]), null);
    });
    test('string returns null', () => {
        assert.strictEqual(parseRecordedEvent('save'), null);
    });
    test('missing timestamp returns null', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'save', uri: 'file:///x' }), null);
    });
    test('non-finite timestamp returns null', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'save', timestamp: Infinity, uri: 'file:///x' }), null);
        assert.strictEqual(parseRecordedEvent({ type: 'save', timestamp: NaN, uri: 'file:///x' }), null);
    });
    test('missing type returns null', () => {
        assert.strictEqual(parseRecordedEvent({ timestamp: ts, uri: 'file:///x' }), null);
    });
    test('unknown type literal returns null', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'somethingNew', timestamp: ts }), null);
    });
    test('prototype-named type literals return null (no Object.prototype leakage)', () => {
        for (const t of ['toString', 'constructor', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__proto__']) {
            assert.strictEqual(parseRecordedEvent({ type: t, timestamp: ts }), null, `type '${t}' must parse to null`);
        }
    });
});

// ── Per-variant happy-path roundtrips ──────────────────────────────────

suite('parseRecordedEvent — per-variant happy path', () => {
    const range = { startLine: 1, startCharacter: 2, endLine: 3, endCharacter: 4 };

    test('textChange', () => {
        const e: RecordedEvent = {
            type: 'textChange', timestamp: ts, uri: 'file:///a.ts',
            changes: [{ range, rangeOffset: 5, rangeLength: 0, text: 'hello' }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('save', () => {
        const e: RecordedEvent = { type: 'save', timestamp: ts, uri: 'file:///a.ts' };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('fileSwitch', () => {
        const e: RecordedEvent = {
            type: 'fileSwitch', timestamp: ts, fromUri: 'file:///a.ts', toUri: 'file:///b.ts',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('fileSwitch with undefined endpoints', () => {
        const e: RecordedEvent = { type: 'fileSwitch', timestamp: ts, fromUri: undefined, toUri: undefined };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('diagnostics', () => {
        const e: RecordedEvent = {
            type: 'diagnostics', timestamp: ts, uri: 'file:///a.ts',
            diagnostics: [{
                code: 'E0001', message: 'oops', severity: 1, range, source: 'tsc',
            }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('buildResult — minimal required fields', () => {
        const e: RecordedEvent = {
            type: 'buildResult', timestamp: ts, successful: true,
            errorCount: 0, failedTests: [], buildFailed: false,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('buildResult — with optional scoping + failed details', () => {
        const e: RecordedEvent = {
            type: 'buildResult', timestamp: ts, successful: false,
            errorCount: 2, failedTests: ['t1', 't2'], buildFailed: false,
            exerciseId: 7, participationId: 8, submissionId: 9,
            failedTestDetails: [{ testName: 't1', detail: 'expected 1 got 2' }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('windowFocus', () => {
        const e: RecordedEvent = { type: 'windowFocus', timestamp: ts, focused: true };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('fileSnapshot', () => {
        const e: RecordedEvent = {
            type: 'fileSnapshot', timestamp: ts, uri: 'file:///a.ts',
            snapshotPath: '/x/snap.txt',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('sessionStart', () => {
        const e: RecordedEvent = {
            type: 'sessionStart', timestamp: ts, exerciseId: 7,
            participantId: 'abc', exerciseRoot: '/workspace/ex', schemaVersion: 3,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('sessionEnd', () => {
        const e: RecordedEvent = { type: 'sessionEnd', timestamp: ts, exerciseId: 7 };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('consentChange — both levels accepted', () => {
        const down: RecordedEvent = { type: 'consentChange', timestamp: ts, level: 'downgraded' };
        const up: RecordedEvent = { type: 'consentChange', timestamp: ts, level: 'upgraded' };
        assert.deepStrictEqual(parseRecordedEvent(clone(down)), down);
        assert.deepStrictEqual(parseRecordedEvent(clone(up)), up);
    });

    test('startupPhaseComplete', () => {
        const e: RecordedEvent = { type: 'startupPhaseComplete', timestamp: ts };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('configurationSnapshot', () => {
        const e: RecordedEvent = {
            type: 'configurationSnapshot', timestamp: ts,
            struggleDetectionEnabled: true, showInterventions: false,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('configurationChange — both keys optional', () => {
        const e: RecordedEvent = {
            type: 'configurationChange', timestamp: ts,
            changes: { struggleDetectionEnabled: true },
        };
        const parsed = parseRecordedEvent(clone(e));
        assert.ok(parsed);
        assert.strictEqual(parsed.type, 'configurationChange');
        if (parsed.type === 'configurationChange') {
            assert.strictEqual(parsed.changes.struggleDetectionEnabled, true);
            assert.strictEqual(parsed.changes.showInterventions, undefined);
        }
    });

    test('irisChatMessage — sent', () => {
        const e: RecordedEvent = {
            type: 'irisChatMessage', timestamp: ts, direction: 'sent', content: 'hi',
            messageId: 'm1', sessionId: 's1', sentAt: ts + 1,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('irisChatSendAttempt — failed with error', () => {
        const e: RecordedEvent = {
            type: 'irisChatSendAttempt', timestamp: ts, content: 'hi',
            status: 'failed', errorMessage: 'rate limited',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('irisChatFeedback', () => {
        const e: RecordedEvent = {
            type: 'irisChatFeedback', timestamp: ts, messageId: 'm1', helpful: false,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('viewNavigation', () => {
        const e: RecordedEvent = {
            type: 'viewNavigation', timestamp: ts, from: 'dashboard', to: 'exerciseDetail',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('panelVisibility', () => {
        const e: RecordedEvent = {
            type: 'panelVisibility', timestamp: ts, panel: 'artemis', visible: true,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('problemStatementScroll', () => {
        const e: RecordedEvent = {
            type: 'problemStatementScroll', timestamp: ts,
            scrollTop: 120, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 950, statementHeight: 1600,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('problemStatementScroll — rejects missing field', () => {
        const raw = {
            type: 'problemStatementScroll', timestamp: ts,
            scrollTop: 120, scrollHeight: 3000, viewportHeight: 800,
            statementTop: 950,
        };
        assert.strictEqual(parseRecordedEvent(raw), null);
    });

    test('problemStatementScroll — rejects non-numeric field', () => {
        const raw = {
            type: 'problemStatementScroll', timestamp: ts,
            scrollTop: '120', scrollHeight: 3000, viewportHeight: 800,
            statementTop: 950, statementHeight: 1600,
        };
        assert.strictEqual(parseRecordedEvent(raw), null);
    });

    test('problemStatementSelection', () => {
        const e: RecordedEvent = {
            type: 'problemStatementSelection', timestamp: ts,
            selectedText: 'implement the constructor', selectionLength: 25, truncated: false,
            selectionTop: 1200, selectionLeft: 40, selectionWidth: 320, selectionHeight: 18,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('problemStatementSelection — truncated long selection round-trips', () => {
        const e: RecordedEvent = {
            type: 'problemStatementSelection', timestamp: ts,
            selectedText: 'x'.repeat(500), selectionLength: 12000, truncated: true,
            selectionTop: 1200, selectionLeft: 0, selectionWidth: 600, selectionHeight: 4000,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('problemStatementSelection — rejects missing geometry', () => {
        const raw = {
            type: 'problemStatementSelection', timestamp: ts,
            selectedText: 'abc', selectionLength: 3, truncated: false,
            selectionTop: 1200, selectionLeft: 0, selectionWidth: 600,
        };
        assert.strictEqual(parseRecordedEvent(raw), null);
    });

    test('problemStatementSelection — rejects non-boolean truncated', () => {
        const raw = {
            type: 'problemStatementSelection', timestamp: ts,
            selectedText: 'abc', selectionLength: 3, truncated: 'no',
            selectionTop: 1200, selectionLeft: 0, selectionWidth: 600, selectionHeight: 18,
        };
        assert.strictEqual(parseRecordedEvent(raw), null);
    });

    test('selectionChange — with kind', () => {
        const e: RecordedEvent = {
            type: 'selectionChange', timestamp: ts, uri: 'file:///a.ts',
            selections: [range], kind: 'mouse',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('visibleRangeChange', () => {
        const e: RecordedEvent = {
            type: 'visibleRangeChange', timestamp: ts, uri: 'file:///a.ts',
            visibleRanges: [range],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('terminalCommand', () => {
        const e: RecordedEvent = {
            type: 'terminalCommand', timestamp: ts, command: 'npm test',
            exitCode: 0, output: 'ok', outputTruncated: false,
            cwd: '/proj', terminalName: 'zsh', durationMs: 1234,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('terminalOpenClose', () => {
        const e: RecordedEvent = {
            type: 'terminalOpenClose', timestamp: ts, action: 'opened', terminalName: 'zsh',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('fileSnapshotError', () => {
        const e: RecordedEvent = {
            type: 'fileSnapshotError', timestamp: ts, uri: 'file:///a.ts',
            reason: 'snapshot-write-failed-after-3-retries',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('fileCreate / fileDelete / textDocumentOpen / textDocumentClose share the simple uri shape', () => {
        for (const type of ['fileCreate', 'fileDelete', 'textDocumentOpen', 'textDocumentClose'] as const) {
            const e = { type, timestamp: ts, uri: 'file:///a.ts' } as RecordedEvent;
            assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
        }
    });

    test('fileRename', () => {
        const e: RecordedEvent = {
            type: 'fileRename', timestamp: ts, oldUri: 'file:///a.ts', newUri: 'file:///b.ts',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('testResultsOverviewView — opened arm', () => {
        const e: RecordedEvent = {
            type: 'testResultsOverviewView', action: 'opened', timestamp: ts,
            viewId: 'v1', exerciseId: 7,
            totalTests: 10, passedTests: 7, failedTests: 3,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('testResultsOverviewView — closed arm', () => {
        const e: RecordedEvent = {
            type: 'testResultsOverviewView', action: 'closed', timestamp: ts,
            viewId: 'v1', exerciseId: 7, durationMs: 500, closeReason: 'escape',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('taskFeedbackView — opened arm', () => {
        const e: RecordedEvent = {
            type: 'taskFeedbackView', action: 'opened', timestamp: ts,
            viewId: 'v1', exerciseId: 7, taskName: 'task A',
            testIds: [1, 2, 3], totalTests: 3, passedTests: 2, failedTests: 1,
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('taskFeedbackView — closed arm', () => {
        const e: RecordedEvent = {
            type: 'taskFeedbackView', action: 'closed', timestamp: ts,
            viewId: 'v1', exerciseId: 7, taskName: 'task A', durationMs: 800,
            closeReason: 'button',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    // ── debugSession ───────────────────────────────────────────────────
    test('debugSession — started with all session fields', () => {
        const e: RecordedEvent = {
            type: 'debugSession', timestamp: ts, action: 'started',
            sessionId: 's1', sessionName: 'Launch', sessionType: 'java', parentSessionId: 'p0',
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('debugSession — activeChanged with no session fields', () => {
        const e: RecordedEvent = { type: 'debugSession', timestamp: ts, action: 'activeChanged' };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    // ── breakpointChange ───────────────────────────────────────────────
    test('breakpointChange — added with full breakpoint payload', () => {
        const e: RecordedEvent = {
            type: 'breakpointChange', timestamp: ts, action: 'added',
            breakpoints: [{
                id: 'b1', uri: 'file:///workspace/ex1/Main.java', line: 9, column: 4,
                enabled: true, condition: 'x > 0', hitCondition: '>= 3', logMessage: 'hit',
            }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('breakpointChange — removed with minimal breakpoint (no optionals)', () => {
        const e: RecordedEvent = {
            type: 'breakpointChange', timestamp: ts, action: 'removed',
            breakpoints: [{ id: 'b1', uri: 'file:///workspace/ex1/Main.java', line: 0, column: 0, enabled: false }],
        };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });

    test('breakpointChange — empty breakpoints array is accepted (matches other array parsers)', () => {
        const e: RecordedEvent = { type: 'breakpointChange', timestamp: ts, action: 'changed', breakpoints: [] };
        assert.deepStrictEqual(parseRecordedEvent(clone(e)), clone(e));
    });
});

// ── Per-variant rejection of tricky shapes ─────────────────────────────

suite('parseRecordedEvent — per-variant rejection', () => {
    const validRange = { startLine: 1, startCharacter: 2, endLine: 3, endCharacter: 4 };

    test('textChange rejects on non-object change entry', () => {
        const bad = {
            type: 'textChange', timestamp: ts, uri: 'file:///a.ts',
            changes: ['not an object'],
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('textChange rejects on malformed range inside change', () => {
        const bad = {
            type: 'textChange', timestamp: ts, uri: 'file:///a.ts',
            changes: [{ range: { startLine: 'x' }, rangeOffset: 0, rangeLength: 0, text: '' }],
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('consentChange rejects unknown level literal', () => {
        const bad = { type: 'consentChange', timestamp: ts, level: 'reset' };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('selectionChange rejects unknown kind literal but accepts undefined', () => {
        const bad = {
            type: 'selectionChange', timestamp: ts, uri: 'file:///a.ts',
            selections: [validRange], kind: 'voice',
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('testResultsOverviewView rejects on missing action', () => {
        const bad = {
            type: 'testResultsOverviewView', timestamp: ts, viewId: 'v1', exerciseId: 7,
            totalTests: 10, passedTests: 7, failedTests: 3,
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('testResultsOverviewView rejects on opened arm with missing total counts', () => {
        const bad = {
            type: 'testResultsOverviewView', action: 'opened', timestamp: ts,
            viewId: 'v1', exerciseId: 7,
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('taskFeedbackView rejects on opened arm with non-numeric testIds', () => {
        const bad = {
            type: 'taskFeedbackView', action: 'opened', timestamp: ts,
            viewId: 'v1', exerciseId: 7, taskName: 't',
            testIds: ['1', '2'], totalTests: 1, passedTests: 1, failedTests: 0,
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('buildResult rejects on non-boolean buildFailed', () => {
        const bad = {
            type: 'buildResult', timestamp: ts, successful: false,
            errorCount: 0, failedTests: [], buildFailed: 0,
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('diagnostics rejects on diagnostic without range', () => {
        const bad = {
            type: 'diagnostics', timestamp: ts, uri: 'file:///a.ts',
            diagnostics: [{ code: 'E1', message: 'x', severity: 1 }],
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('diagnostics rejects diagnostic with present-but-wrong-typed code (regression)', () => {
        // Pre-fix this slipped through and silently coerced `code` to undefined,
        // losing the schema failure signal. Now an explicit non-string/non-number
        // `code` must trip the validator.
        const bad = {
            type: 'diagnostics', timestamp: ts, uri: 'file:///a.ts',
            diagnostics: [{
                code: { weird: 'object' }, message: 'x', severity: 1,
                range: validRange, source: 'tsc',
            }],
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('diagnostics rejects diagnostic with present-but-wrong-typed source (regression)', () => {
        const bad = {
            type: 'diagnostics', timestamp: ts, uri: 'file:///a.ts',
            diagnostics: [{
                code: 'E1', message: 'x', severity: 1,
                range: validRange, source: 42,
            }],
        };
        assert.strictEqual(parseRecordedEvent(bad), null);
    });

    test('diagnostics accepts diagnostic with absent code and source', () => {
        const e = {
            type: 'diagnostics', timestamp: ts, uri: 'file:///a.ts',
            diagnostics: [{ message: 'x', severity: 1, range: validRange }],
        };
        const parsed = parseRecordedEvent(clone(e));
        assert.ok(parsed);
        assert.strictEqual(parsed.type, 'diagnostics');
        if (parsed.type === 'diagnostics') {
            assert.strictEqual(parsed.diagnostics[0].code, undefined);
            assert.strictEqual(parsed.diagnostics[0].source, undefined);
        }
    });
});

// ── SessionMetadata ────────────────────────────────────────────────────

suite('parseSessionMetadata', () => {
    test('happy path — all fields including optional', () => {
        const m: SessionMetadata = {
            sessionId: 'abc', exerciseId: 7, participantId: 'student-1',
            startTime: ts, endTime: ts + 1000, eventCount: 42,
            schemaVersion: 3, recorderVersion: '0.4.4',
        };
        assert.deepStrictEqual(parseSessionMetadata(clone(m)), clone(m));
    });

    test('happy path — endTime null is accepted (session still open)', () => {
        const m: SessionMetadata = {
            sessionId: 'abc', exerciseId: 7, participantId: undefined,
            startTime: ts, endTime: null, eventCount: 0,
        };
        assert.deepStrictEqual(parseSessionMetadata(clone(m)), clone(m));
    });

    test('happy path — endTime undefined also accepted', () => {
        const data = {
            sessionId: 'abc', exerciseId: 7, participantId: undefined,
            startTime: ts, eventCount: 0,
        };
        const parsed = parseSessionMetadata(clone(data));
        assert.ok(parsed);
        assert.strictEqual(parsed.endTime, undefined);
    });

    test('rejects non-object', () => {
        assert.strictEqual(parseSessionMetadata(null), null);
        assert.strictEqual(parseSessionMetadata('bad'), null);
        assert.strictEqual(parseSessionMetadata([]), null);
    });

    test('rejects missing sessionId', () => {
        const bad = { exerciseId: 7, participantId: 'x', startTime: ts, endTime: null, eventCount: 0 };
        assert.strictEqual(parseSessionMetadata(bad), null);
    });

    test('rejects non-numeric exerciseId', () => {
        const bad = {
            sessionId: 'a', exerciseId: '7', participantId: undefined,
            startTime: ts, endTime: null, eventCount: 0,
        };
        assert.strictEqual(parseSessionMetadata(bad), null);
    });

    test('rejects endTime that is neither number nor null nor undefined', () => {
        const bad = {
            sessionId: 'a', exerciseId: 7, participantId: undefined,
            startTime: ts, endTime: 'still running', eventCount: 0,
        };
        assert.strictEqual(parseSessionMetadata(bad), null);
    });

    test('rejects non-finite startTime', () => {
        const bad = {
            sessionId: 'a', exerciseId: 7, participantId: undefined,
            startTime: NaN, endTime: null, eventCount: 0,
        };
        assert.strictEqual(parseSessionMetadata(bad), null);
    });
});

suite('parseRecordedEvent — debug/breakpoint per-variant rejection', () => {
    test('debugSession rejects an invalid action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'debugSession', timestamp: ts, action: 'paused' }), null);
    });
    test('debugSession rejects a missing action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'debugSession', timestamp: ts }), null);
    });
    test('debugSession rejects a non-string sessionId', () => {
        assert.strictEqual(
            parseRecordedEvent({ type: 'debugSession', timestamp: ts, action: 'started', sessionId: 42 }),
            null,
        );
    });
    test('breakpointChange rejects an invalid action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, action: 'moved', breakpoints: [] }), null);
    });
    test('breakpointChange rejects a missing action', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, breakpoints: [] }), null);
    });
    test('breakpointChange rejects a non-array breakpoints', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'breakpointChange', timestamp: ts, action: 'added', breakpoints: {} }), null);
    });
    test('breakpointChange rejects a breakpoint missing a required field', () => {
        assert.strictEqual(
            parseRecordedEvent({
                type: 'breakpointChange', timestamp: ts, action: 'added',
                breakpoints: [{ id: 'b1', uri: 'file:///x', line: 1 /* column missing */, enabled: true }],
            }),
            null,
        );
    });
    test('breakpointChange rejects a breakpoint with a wrong-typed optional', () => {
        assert.strictEqual(
            parseRecordedEvent({
                type: 'breakpointChange', timestamp: ts, action: 'added',
                breakpoints: [{ id: 'b1', uri: 'file:///x', line: 1, column: 0, enabled: true, condition: 5 }],
            }),
            null,
        );
    });
});

suite('parseRecordedEvent — submission', () => {
    test('round-trips a started submission', () => {
        const ev = { type: 'submission', timestamp: 100, status: 'started', participationId: 42, commitMessage: 'wip' };
        assert.deepStrictEqual(parseRecordedEvent(ev), ev);
    });

    test('round-trips a succeeded submission with exerciseId', () => {
        const ev = { type: 'submission', timestamp: 200, status: 'succeeded', participationId: 42, exerciseId: 7, commitMessage: 'final' };
        assert.deepStrictEqual(parseRecordedEvent(ev), ev);
    });

    test('round-trips a failed submission with a failureReason', () => {
        const ev = { type: 'submission', timestamp: 300, status: 'failed', participationId: 42, failureReason: 'merge-conflict' };
        assert.deepStrictEqual(parseRecordedEvent(ev), ev);
    });

    test('omits absent optional fields (no undefined keys)', () => {
        const ev = { type: 'submission', timestamp: 400, status: 'started', participationId: 1 };
        const parsed = parseRecordedEvent(ev);
        assert.deepStrictEqual(parsed, ev);
        assert.ok(parsed && parsed.type === 'submission', 'should parse as a submission event');
        assert.ok(parsed && !('exerciseId' in parsed));
        assert.ok(parsed && !('failureReason' in parsed));
    });

    test('rejects missing status', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, participationId: 1 }), null);
    });

    test('rejects an unknown status', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'queued', participationId: 1 }), null);
    });

    test('rejects missing participationId', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'started' }), null);
    });

    test('rejects a non-numeric participationId', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'started', participationId: '1' }), null);
    });

    test('rejects an unknown failureReason', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'failed', participationId: 1, failureReason: 'nope' }), null);
    });

    test('rejects a non-numeric exerciseId', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'started', participationId: 1, exerciseId: '7' }), null);
    });

    test('rejects a non-string commitMessage', () => {
        assert.strictEqual(parseRecordedEvent({ type: 'submission', timestamp: 1, status: 'started', participationId: 1, commitMessage: 123 }), null);
    });
});

// ── KNOWN_EVENT_TYPES drift regression (#215) ─────────────────────────
//
// `scripts/validate-recording.ts` used to keep its own hand-synced Set of
// known event types, which drifted from the parser. KNOWN_EVENT_TYPES is now
// derived from the EVENT_PARSERS dispatch table and shared with the validator,
// so the two can no longer drift. These assertions guard that the shared set
// still recognizes the event types that historically drifted (or were added
// after the original drift), and excludes unknown / inherited-prototype keys.

suite('KNOWN_EVENT_TYPES — drift regression for #215', () => {
    test('contains the event types that historically drifted out of the validator', () => {
        // The original #215 drift cases (missing from the validator's old Set)
        // plus the debugger / submission types added afterwards in #233 / #236.
        const mustContain = [
            'configurationSnapshot',
            'configurationChange',
            'testResultsOverviewView',
            'taskFeedbackView',
            'debugSession',
            'breakpointChange',
            'submission',
        ];
        for (const t of mustContain) {
            assert.ok(KNOWN_EVENT_TYPES.has(t), `KNOWN_EVENT_TYPES is missing '${t}'`);
        }
    });

    test('excludes unknown and inherited-prototype keys', () => {
        for (const t of ['', 'totallyMadeUp', 'toString', '__proto__', 'constructor']) {
            assert.ok(!KNOWN_EVENT_TYPES.has(t), `KNOWN_EVENT_TYPES unexpectedly contains '${t}'`);
        }
    });
});

// ── Backward-compat: removed event schema is tolerated, not crashed ───
//
// Old recordings on disk may still carry the deleted EQ event types and the
// removed buildResult.buildErrorFamilies field. The parser must skip / ignore
// them (return null for unknown types, drop unknown keys), never throw.
suite('parseRecordedEvent — removed-schema backward compatibility', () => {
    test('legacy eqSnapshot line is skipped (unknown type → null)', () => {
        const legacy = {
            type: 'eqSnapshot', timestamp: ts, eq: 0.42,
            confidence: 'sufficient', source: 'save', triggerType: 'execution-error',
        };
        assert.strictEqual(parseRecordedEvent(legacy), null);
    });

    test('legacy eqEngineState line is skipped (unknown type → null)', () => {
        const legacy = {
            type: 'eqEngineState', timestamp: ts,
            snapshots: [{ timestamp: ts - 1, hasErrors: true, errorFamilies: ['compile'], errorCount: 3 }],
            currentEQ: 0.18, pairCount: 5, confidence: 'sufficient',
        };
        assert.strictEqual(parseRecordedEvent(legacy), null);
    });

    test('legacy intervention line is skipped (unknown type → null)', () => {
        const legacy = {
            type: 'intervention', timestamp: ts, action: 'shown', level: 'subtle',
            shouldIntervene: true, eq: 0.3, confidence: 'sufficient',
        };
        assert.strictEqual(parseRecordedEvent(legacy), null);
    });

    test('legacy buildResult.buildErrorFamilies is ignored, event still parses', () => {
        const legacy = {
            type: 'buildResult', timestamp: ts, successful: false,
            errorCount: 1, failedTests: ['t1'], buildFailed: false,
            buildErrorFamilies: ['type-mismatch'],
        };
        const parsed = parseRecordedEvent(legacy);
        assert.ok(parsed && parsed.type === 'buildResult', 'buildResult still parses');
        assert.ok(!('buildErrorFamilies' in parsed), 'buildErrorFamilies dropped from output');
    });
});
