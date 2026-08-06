import * as assert from 'assert';

import { ChatDiagnosticsService } from '@extension/services/iris/chat/chatDiagnosticsService';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import type { SessionIdentityReader, SessionState } from '@extension/services/session/sessionIdentityCoordinator';
import { WorkspaceExerciseTracker } from '@extension/services/workspace/workspaceExerciseTracker';

/**
 * The report is asked for when the chat is behaving oddly, and what it is
 * mostly asked about is the OPEN CONVERSATION. The deleted "Debug Sessions
 * (Raw)" command described the local session store that no longer exists, and
 * the decision to delete it rested on the diagnostics report covering the rest.
 */
function fakeConversation(): IrisConversationService {
    return {
        state: {
            snapshot: () => ({
                courseId: 42,
                currentSessionId: 900,
                detail: { title: 'BFS loop', messages: [{ id: 1 }, { id: 2 }] },
                committedContext: { mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, name: 'Sorting' },
                pendingContext: { ctx: { mode: 'COURSE_CHAT', entityId: 42 } },
                courseSessions: [{ sessionId: 900 }, { sessionId: 901 }],
                knownInvisible: [{ sessionId: 902 }],
            }),
            contentState: () => 'content',
            displayMessageCount: () => 2,
            sendInFlight: true,
        },
        navigationInFlight: false,
    } as unknown as IrisConversationService;
}

function fakeSession(state: SessionState, epoch = 3): SessionIdentityReader {
    return { state, epoch };
}

const registry = { getAllExercises: () => [] } as never;
const emptyCatalog = { projection: () => ({ courses: [], exercises: [] }) } as never;

suite('ChatDiagnosticsService: the conversation section', () => {
    test('reports the open conversation, both topics and the index sizes', () => {
        const service = new ChatDiagnosticsService(
            emptyCatalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => fakeConversation(),
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /Session ID: 900/);
        assert.match(report, /Course ID: 42/);
        assert.match(report, /Title: BFS loop/);
        assert.match(report, /Committed topic: PROGRAMMING_EXERCISE_CHAT\/7 \(Sorting\)/);
        assert.match(report, /Staged topic: COURSE_CHAT\/42/);
        assert.match(report, /Content state: content/);
        assert.match(report, /Messages \(displayed \/ stored\): 2 \/ 2/);
        assert.match(report, /Send in flight: true/);
        assert.match(report, /Overview rows: 2 \(\+1 known but unlisted\)/);
    });

    test('says so plainly when there is no conversation service at all', () => {
        const service = new ChatDiagnosticsService(
            emptyCatalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => undefined,
        );

        assert.match(service.generateDiagnosticsReport(), /No conversation service/);
    });
});

/**
 * The identity line diagnostics gained in the live-catalog work: a support
 * request starts with "which account, which server, which generation", so
 * it has to be answered even when nothing else in the report is interesting.
 */
suite('ChatDiagnosticsService: session identity', () => {
    test('names the authenticated principal, server and epoch', () => {
        const service = new ChatDiagnosticsService(
            emptyCatalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'authenticated', serverKey: 'https://artemis.test', principal: 'ab12cde' }, 5),
            registry,
            () => undefined,
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /SESSION: authenticated ab12cde on https:\/\/artemis\.test, epoch 5/);
    });

    test('names an anonymous session without inventing a principal', () => {
        const service = new ChatDiagnosticsService(
            emptyCatalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }, 0),
            registry,
            () => undefined,
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /SESSION: anonymous on https:\/\/artemis\.test, epoch 0/);
    });
});

/**
 * The catalog is the live source now: nothing here is read off a persisted
 * snapshot any more.
 */
suite('ChatDiagnosticsService: catalog and workspace sections', () => {
    test('reports the workspace exercise from the tracker, not from any store', () => {
        const tracker = new WorkspaceExerciseTracker();
        tracker.set({ id: 9, title: 'DFS', shortName: 'dfs', courseId: 42 });

        const service = new ChatDiagnosticsService(
            emptyCatalog,
            tracker,
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => undefined,
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /WORKSPACE EXERCISE:\n {2}\[9\] DFS/);
        assert.match(report, /Course ID: 42/);
    });

    test('says so plainly when no exercise is tracked', () => {
        const service = new ChatDiagnosticsService(
            emptyCatalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => undefined,
        );

        assert.match(service.generateDiagnosticsReport(), /No workspace exercise tracked/);
    });

    test('reports courses and exercises from the catalog projection, tagged live', () => {
        const catalog = {
            projection: () => ({
                courses: [{ id: 42, title: 'Algorithms', shortName: 'algo' }],
                exercises: [{ id: 9, courseId: 42, title: 'DFS', pickable: true }],
            }),
        } as never;

        const service = new ChatDiagnosticsService(
            catalog,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => undefined,
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /EXERCISES \(1\) - live catalog/);
        assert.match(report, /\[9\] DFS/);
        assert.match(report, /COURSES \(1\) - live catalog/);
        assert.match(report, /\[42\] Algorithms/);
    });

    test('tolerates no catalog at all', () => {
        const service = new ChatDiagnosticsService(
            undefined,
            new WorkspaceExerciseTracker(),
            fakeSession({ kind: 'anonymous', serverKey: 'https://artemis.test' }),
            registry,
            () => undefined,
        );

        const report = service.generateDiagnosticsReport();

        assert.match(report, /No exercises tracked/);
        assert.match(report, /No courses tracked/);
    });
});
