import * as assert from 'assert';

import { ChatDiagnosticsService } from '@extension/services/iris/chat/chatDiagnosticsService';
import { ContextStore } from '@extension/services/iris/context/contextStore';
import type { IrisConversationService } from '@extension/services/iris/conversation/conversationService';
import { MockExtensionContext } from '@test/unit/mocks/vscodeMocks';

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

suite('ChatDiagnosticsService: the conversation section', () => {
    const registry = { getAllExercises: () => [] } as never;

    test('reports the open conversation, both topics and the index sizes', () => {
        const store = new ContextStore(new MockExtensionContext());
        const service = new ChatDiagnosticsService(store, registry, () => fakeConversation());

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
        const store = new ContextStore(new MockExtensionContext());
        const service = new ChatDiagnosticsService(store, registry, () => undefined);

        assert.match(service.generateDiagnosticsReport(), /No conversation service/);
    });
});
