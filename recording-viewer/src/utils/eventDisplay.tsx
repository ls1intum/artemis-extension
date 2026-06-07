import type { RecordedEvent } from '../types';
import { formatOffset, formatDuration, shortenUri, formatDebugSessionMeta, formatBreakpointLocation } from './format';

// Single source of truth for rendering a recorded event. Both the event-stream
// detail row and the tracking-timeline tooltip key off event.type here, so a new
// event type (or a field/shape change) is handled in exactly one place.

// Full, multi-field description shown in the event stream's expandable detail row.
export function eventDetail(event: RecordedEvent): React.ReactNode {
    switch (event.type) {
        case 'eqSnapshot':
            return (
                <span className="event-detail">
                    EQ: <strong>{Math.round(event.eq * 100)}%</strong>
                    <span className={`confidence-tag ${event.confidence}`}>{event.confidence}</span>
                </span>
            );
        case 'buildResult':
            return (
                <span className="event-detail">
                    {event.buildFailed ? 'BUILD FAILED' : event.successful ? 'PASSED' : `${event.errorCount} error(s)`}
                    {event.failedTests.length > 0 && ` | ${event.failedTests.length} test(s) failed`}
                </span>
            );
        case 'textChange': {
            const MAX_INLINE = 16;
            let insertedAll = '';
            let deletedTotal = 0;
            for (const c of event.changes) {
                insertedAll += c.text;
                deletedTotal += c.rangeLength;
            }
            const hasInsert = insertedAll.length > 0;
            const hasDelete = deletedTotal > 0;

            const inlineText = insertedAll.length <= MAX_INLINE
                ? <code className="inline-text">{insertedAll}</code>
                : <><code className="inline-text">{insertedAll.slice(0, MAX_INLINE)}</code> +{insertedAll.length - MAX_INLINE} chars</>;

            let op: React.ReactNode;
            if (hasInsert && hasDelete) {
                op = <span className="change-preview">replaced {deletedTotal} &rarr; {inlineText}</span>;
            } else if (hasInsert) {
                op = <span className="change-preview">inserted {inlineText}</span>;
            } else {
                op = <span className="change-preview">deleted {deletedTotal} chars</span>;
            }

            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {op}
                </span>
            );
        }
        case 'save':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'diagnostics':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {event.diagnostics.length} diagnostic(s)
                </span>
            );
        case 'fileSwitch':
            return (
                <span className="event-detail">
                    {shortenUri(event.fromUri)} &rarr; {shortenUri(event.toUri)}
                </span>
            );
        case 'sessionStart':
            return (
                <span className="event-detail">
                    Exercise {event.exerciseId}
                    {event.participantId && ` | ${event.participantId}`}
                </span>
            );
        case 'sessionEnd':
            return <span className="event-detail">Exercise {event.exerciseId}</span>;
        case 'irisChatMessage':
            return (
                <span className="event-detail">
                    {event.direction === 'sent' ? 'SENT' : 'RECV'}:&nbsp;
                    {event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content}
                    {event.messageId && <span className="event-meta"> id:{event.messageId}</span>}
                </span>
            );
        case 'irisChatSendAttempt':
            return (
                <span className="event-detail">
                    {event.status.toUpperCase()}:&nbsp;
                    {event.content.length > 80 ? event.content.slice(0, 80) + '...' : event.content}
                    {event.errorMessage && <span className="event-error"> — {event.errorMessage}</span>}
                </span>
            );
        case 'irisChatFeedback':
            return (
                <span className="event-detail">
                    msg:{event.messageId} | {event.helpful ? 'helpful' : 'not helpful'}
                </span>
            );
        case 'windowFocus':
            return <span className="event-detail">{event.focused ? 'focused' : 'blurred'}</span>;
        case 'fileSnapshot':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'selectionChange':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | L{event.selections[0]?.startLine ?? 0}:{event.selections[0]?.startCharacter ?? 0}
                    {event.kind && ` (${event.kind})`}
                </span>
            );
        case 'visibleRangeChange':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | L{event.visibleRanges[0]?.startLine ?? 0}-L{event.visibleRanges[0]?.endLine ?? 0}
                </span>
            );
        case 'intervention':
            return (
                <span className="event-detail">
                    {event.action.toUpperCase()} | {event.level} | EQ: <strong>{Math.round(event.eq * 100)}%</strong>
                    {event.triggerType && ` | ${event.triggerType}`}
                    {event.action === 'blocked' && event.blockedReason && ` | reason: ${event.blockedReason}`}
                </span>
            );
        case 'eqEngineState':
            return (
                <span className="event-detail">
                    {event.snapshots.length} snapshot(s) | EQ: <strong>{Math.round(event.currentEQ * 100)}%</strong>
                    <span className={`confidence-tag ${event.confidence}`}>{event.confidence}</span>
                </span>
            );
        case 'viewNavigation':
            return (
                <span className="event-detail">
                    {event.from} &rarr; {event.to}
                </span>
            );
        case 'panelVisibility':
            return (
                <span className="event-detail">
                    {event.panel} | {event.visible ? 'visible' : 'hidden'}
                </span>
            );
        case 'testResultsOverviewView':
            if (event.action === 'opened') {
                return (
                    <span className="event-detail">
                        Test results overview opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)
                    </span>
                );
            }
            return (
                <span className="event-detail">
                    Test results overview closed | {formatDuration(event.durationMs)} ({event.closeReason})
                </span>
            );
        case 'taskFeedbackView':
            if (event.action === 'opened') {
                return (
                    <span className="event-detail">
                        Task "{event.taskName}" opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)
                    </span>
                );
            }
            return (
                <span className="event-detail">
                    Task "{event.taskName}" closed | {formatDuration(event.durationMs)} ({event.closeReason})
                </span>
            );
        case 'configurationSnapshot':
            return (
                <span className="event-detail">
                    struggleDetection:{event.struggleDetectionEnabled ? 'on' : 'off'} | interventions:{event.showInterventions ? 'on' : 'off'}
                </span>
            );
        case 'configurationChange': {
            const parts: string[] = [];
            if (event.changes.struggleDetectionEnabled !== undefined) {
                parts.push(`struggleDetection:${event.changes.struggleDetectionEnabled ? 'on' : 'off'}`);
            }
            if (event.changes.showInterventions !== undefined) {
                parts.push(`interventions:${event.changes.showInterventions ? 'on' : 'off'}`);
            }
            return <span className="event-detail">{parts.join(' | ')}</span>;
        }
        case 'terminalCommand': {
            const exitOk = event.exitCode === 0;
            return (
                <span className="event-detail terminal-detail">
                    <code>{event.command.length > 60 ? event.command.slice(0, 60) + '...' : event.command}</code>
                    {' '}exit: <strong className={exitOk ? 'terminal-exit-ok' : 'terminal-exit-fail'}>{event.exitCode ?? '?'}</strong>
                    {' '}({Math.round(event.durationMs / 1000)}s)
                    {event.outputTruncated && ' [truncated]'}
                </span>
            );
        }
        case 'terminalOpenClose':
            return (
                <span className="event-detail">
                    {event.action} | {event.terminalName}
                </span>
            );
        case 'fileSnapshotError':
            return (
                <span className="event-detail">
                    {shortenUri(event.uri)} | {event.reason}
                </span>
            );
        case 'fileCreate':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'fileDelete':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'fileRename':
            return (
                <span className="event-detail">
                    {shortenUri(event.oldUri)} &rarr; {shortenUri(event.newUri)}
                </span>
            );
        case 'textDocumentOpen':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'textDocumentClose':
            return <span className="event-detail">{shortenUri(event.uri)}</span>;
        case 'debugSession':
            return (
                <span className="event-detail">
                    {event.action}{formatDebugSessionMeta(event.sessionName, event.sessionType)}
                </span>
            );
        case 'breakpointChange': {
            const first = event.breakpoints[0];
            return (
                <span className="event-detail">
                    {event.action} | {event.breakpoints.length} breakpoint(s)
                    {first && ` | ${formatBreakpointLocation(first.uri, first.line)}`}
                </span>
            );
        }
        case 'submission':
            return (
                <span className="event-detail">
                    SUBMIT {event.status.toUpperCase()} | participation {event.participationId}
                    {event.commitMessage && ` | "${event.commitMessage.length > 60 ? event.commitMessage.slice(0, 60) + '...' : event.commitMessage}"`}
                    {event.failureReason && <span className="event-error"> — {event.failureReason}</span>}
                </span>
            );
        default:
            return null;
    }
}

// Compact single-line summary shown in the tracking-timeline tooltip.
export function eventSummary(event: RecordedEvent, sessionStartTime: number): React.ReactNode {
    const time = formatOffset(event.timestamp - sessionStartTime);
    switch (event.type) {
        case 'textChange': {
            let inserted = 0, deleted = 0;
            for (const c of event.changes) { inserted += c.text.length; deleted += c.rangeLength; }
            const op = inserted > 0 && deleted > 0 ? `replaced ${deleted} → ${inserted} chars`
                : inserted > 0 ? `+${inserted} chars` : `-${deleted} chars`;
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | {op}</>;
        }
        case 'save':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'diagnostics':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | {event.diagnostics.length} diagnostic(s)</>;
        case 'fileSwitch':
            return <><span className="tt-time">{time}</span> {shortenUri(event.fromUri)} → {shortenUri(event.toUri)}</>;
        case 'buildResult':
            return <><span className="tt-time">{time}</span> {event.buildFailed ? 'BUILD FAILED' : event.successful ? 'PASSED' : `${event.errorCount} error(s)`}{event.failedTests.length > 0 ? ` | ${event.failedTests.length} test(s) failed` : ''}</>;
        case 'eqSnapshot':
            return <><span className="tt-time">{time}</span> EQ: {Math.round(event.eq * 100)}% ({event.confidence})</>;
        case 'eqEngineState':
            return <><span className="tt-time">{time}</span> EQ: {Math.round(event.currentEQ * 100)}% ({event.confidence}) | {event.snapshots.length} snapshot(s)</>;
        case 'sessionStart':
            return <><span className="tt-time">{time}</span> Exercise {event.exerciseId}{event.participantId ? ` | ${event.participantId}` : ''}</>;
        case 'sessionEnd':
            return <><span className="tt-time">{time}</span> Exercise {event.exerciseId}</>;
        case 'irisChatMessage':
            return <><span className="tt-time">{time}</span> {event.direction === 'sent' ? 'SENT' : 'RECV'}: {event.content.length > 50 ? event.content.slice(0, 50) + '...' : event.content}{event.messageId ? ` (id:${event.messageId})` : ''}</>;
        case 'irisChatSendAttempt':
            return <><span className="tt-time">{time}</span> {event.status.toUpperCase()}: {event.content.length > 50 ? event.content.slice(0, 50) + '...' : event.content}{event.errorMessage ? ` — ${event.errorMessage}` : ''}</>;
        case 'irisChatFeedback':
            return <><span className="tt-time">{time}</span> msg:{event.messageId} | {event.helpful ? 'helpful' : 'not helpful'}</>;
        case 'windowFocus':
            return <><span className="tt-time">{time}</span> {event.focused ? 'focused' : 'blurred'}</>;
        case 'fileSnapshot':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'selectionChange':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | L{event.selections[0]?.startLine ?? 0}:{event.selections[0]?.startCharacter ?? 0}{event.kind ? ` (${event.kind})` : ''}</>;
        case 'visibleRangeChange':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | L{event.visibleRanges[0]?.startLine ?? 0}-L{event.visibleRanges[0]?.endLine ?? 0}</>;
        case 'intervention':
            return <><span className="tt-time">{time}</span> {event.action.toUpperCase()} | {event.level} | EQ: {Math.round(event.eq * 100)}%{event.triggerType ? ` | ${event.triggerType}` : ''}</>;
        case 'viewNavigation':
            return <><span className="tt-time">{time}</span> {event.from} → {event.to}</>;
        case 'panelVisibility':
            return <><span className="tt-time">{time}</span> {event.panel} | {event.visible ? 'visible' : 'hidden'}</>;
        case 'testResultsOverviewView':
            return event.action === 'opened'
                ? <><span className="tt-time">{time}</span> Test results overview opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)</>
                : <><span className="tt-time">{time}</span> Test results overview closed | {formatDuration(event.durationMs)} ({event.closeReason})</>;
        case 'taskFeedbackView':
            return event.action === 'opened'
                ? <><span className="tt-time">{time}</span> Task "{event.taskName}" opened | {event.passedTests}/{event.totalTests} passed ({event.failedTests} failed)</>
                : <><span className="tt-time">{time}</span> Task "{event.taskName}" closed | {formatDuration(event.durationMs)} ({event.closeReason})</>;
        case 'configurationSnapshot':
            return <><span className="tt-time">{time}</span> struggleDetection:{event.struggleDetectionEnabled ? 'on' : 'off'} | interventions:{event.showInterventions ? 'on' : 'off'}</>;
        case 'configurationChange': {
            const parts: string[] = [];
            if (event.changes.struggleDetectionEnabled !== undefined) {
                parts.push(`struggleDetection:${event.changes.struggleDetectionEnabled ? 'on' : 'off'}`);
            }
            if (event.changes.showInterventions !== undefined) {
                parts.push(`interventions:${event.changes.showInterventions ? 'on' : 'off'}`);
            }
            return <><span className="tt-time">{time}</span> {parts.join(' | ')}</>;
        }
        case 'terminalCommand':
            return <><span className="tt-time">{time}</span> <code>{event.command.length > 40 ? event.command.slice(0, 40) + '...' : event.command}</code> exit: {event.exitCode ?? '?'} ({Math.round(event.durationMs / 1000)}s){event.outputTruncated ? ' [truncated]' : ''}</>;
        case 'terminalOpenClose':
            return <><span className="tt-time">{time}</span> {event.action} | {event.terminalName}</>;
        case 'fileSnapshotError':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)} | {event.reason}</>;
        case 'fileCreate':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'fileDelete':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'fileRename':
            return <><span className="tt-time">{time}</span> {shortenUri(event.oldUri)} → {shortenUri(event.newUri)}</>;
        case 'textDocumentOpen':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'textDocumentClose':
            return <><span className="tt-time">{time}</span> {shortenUri(event.uri)}</>;
        case 'debugSession':
            return <><span className="tt-time">{time}</span> {event.action}{formatDebugSessionMeta(event.sessionName, event.sessionType)}</>;
        case 'breakpointChange': {
            const first = event.breakpoints[0];
            const where = first ? formatBreakpointLocation(first.uri, first.line) : '';
            return <><span className="tt-time">{time}</span> {event.action} | {event.breakpoints.length} bp{event.breakpoints.length === 1 ? '' : 's'}{where ? ` | ${where}` : ''}</>;
        }
        case 'submission':
            return <><span className="tt-time">{time}</span> SUBMIT {event.status.toUpperCase()} | participation {event.participationId}{event.commitMessage ? ` | "${event.commitMessage.length > 40 ? event.commitMessage.slice(0, 40) + '...' : event.commitMessage}"` : ''}{event.failureReason ? ` — ${event.failureReason}` : ''}</>;
        default:
            return <span className="tt-time">{time}</span>;
    }
}
