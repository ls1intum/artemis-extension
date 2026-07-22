import { describe, expect, it, vi } from 'vitest';

// IrisWebSocketMessageHandler allocates a `new vscode.EventEmitter()` field
// (_onDidReceiveIrisChatMessage), so constructing the REAL handler needs that
// symbol. Mirror the shared vitest vscode stub (which has no EventEmitter)
// with a minimal one; nothing else here touches vscode at runtime.
vi.mock('vscode', () => {
    class EventEmitter<T> {
        event = (): { dispose(): void } => ({ dispose: () => { /* no-op */ } });
        fire(_value?: T): void { /* no-op */ }
        dispose(): void { /* no-op */ }
    }
    return { EventEmitter };
});

import type { ExtensionToWebviewMessage } from '@shared/messageContracts';

import { IrisWebSocketMessageHandler } from '@extension/services/iris/chat/irisWebSocketMessageHandler';
import { IrisRunStateMachine } from '@extension/services/iris/irisRunStateMachine';

/**
 * Regression coverage for the FIX described in the whole-branch review: a
 * USER-sender MESSAGE frame must never finalize the current run, even if it
 * arrives scoped to the current run's runId (today the server always sends
 * USER frames with runId/runState null, but the handler must not depend on
 * that contract — see the comment on `_handleMessage`).
 */
describe('IrisWebSocketMessageHandler: USER frames never finalize a run', () => {
    it('a USER MESSAGE scoped to the current run leaves it waiting and still accepting PARTIALs', () => {
        const runs = new IrisRunStateMachine();
        const posted: ExtensionToWebviewMessage[] = [];

        const handler = new IrisWebSocketMessageHandler(
            undefined,
            () => undefined,
            (message) => posted.push(message),
            runs,
            () => 's1',
        );

        // Start a generation and bind run 'A' as current, mirroring a real send.
        runs.beginGeneration();
        handler.handleIrisWebSocketMessage({ type: 'PARTIAL', runId: 'A', partialResult: 'first draft', partialSeq: 1 });
        expect(runs.currentRunId).toBe('A');
        expect(runs.waiting).toBe(true);

        // A USER frame scoped to the current run (the hypothetical dangerous
        // case the FIX guards against, not today's actual server behaviour).
        handler.handleIrisWebSocketMessage({
            type: 'MESSAGE',
            runId: 'A',
            message: { sender: 'USER', content: 'the user prompt, echoed back' },
        });

        // The run must still be waiting: the USER frame must not have reached
        // finalizeRun.
        expect(runs.waiting).toBe(true);

        // A subsequent assistant PARTIAL for the same run must still be
        // accepted. If the USER frame had wrongly finalized run 'A', it would
        // be in `_finalizedRunIds` and this PARTIAL would be silently dropped.
        posted.length = 0;
        handler.handleIrisWebSocketMessage({ type: 'PARTIAL', runId: 'A', partialResult: 'second draft', partialSeq: 2 });

        const runUiUpdates = posted.filter((m) => m.type === 'updateIrisRunUi');
        expect(runUiUpdates).toHaveLength(1);
        const projection = runUiUpdates[0] as Extract<ExtensionToWebviewMessage, { type: 'updateIrisRunUi' }>;
        expect(projection.projection.draft).toEqual({ runId: 'A', text: 'second draft' });
    });
});
