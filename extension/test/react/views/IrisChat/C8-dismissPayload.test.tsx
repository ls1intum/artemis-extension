/**
 * C8: Webview Dismiss button sources proactiveEpisodeId from the message and
 * includes it in the messageProactiveOutcome command payload.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage } from '@test/react/__helpers__/vscodeApi';
import { useChatStore } from '@webview/stores/useChatStore';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

vi.mock('streamdown', () => ({
    Streamdown: ({ children }: { children?: string }) => (
        <span data-testid="streamdown">{children}</span>
    ),
}));

vi.mock('use-stick-to-bottom', () => ({
    useStickToBottom: vi.fn().mockReturnValue({
        scrollRef: { current: null },
        contentRef: { current: null },
        isAtBottom: true,
        scrollToBottom: vi.fn(),
    }),
}));

vi.mock('@webview/views/IrisChat/components/CodeBlock', () => ({
    CodeBlock: ({ children }: { language?: string; children?: string }) => (
        <pre><code>{children}</code></pre>
    ),
}));

const HYDRATED = {
    context: { type: 'exercise' as const, id: 1, title: 'Ex', locked: false, source: 'user-selected' as const, selectedAt: 0 },
    activeSessionId: 'local-test',
    sessions: [{ id: 'local-test', artemisSessionId: 42, preview: '', title: '', messageCount: 0, createdAt: 0, lastActivity: 0 }],
    messageLoad: { localSessionId: 'local-test', status: 'success' as const },
};

describe('C8: Dismiss payload includes proactiveEpisodeId', () => {
    beforeEach(() => {
        useChatStore.setState({
            context: null,
            activeSessionId: null,
            sessions: [],
            exercises: [],
            courses: [],
            messages: [],
            messageLoad: null,
            suppressedIds: new Set(),
            staleAskBindings: new Map(),
            foldStates: new Map(),
            liveEpisodeIds: new Set(),
            streaming: { isStreaming: false },
            irisStages: [],
            isLoading: false,
            webSocketStatus: 'connected',
            disabledMessage: null,
            unavailableMessage: null,
            isNoAiDetected: false,
            referencedFiles: null,
            showDiagnostics: false,
            hasReceivedInitialIrisState: true,
        });
    });

    it('Dismiss posts messageProactiveOutcome with proactiveEpisodeId from the message', async () => {
        useChatStore.setState(HYDRATED);
        const mockApi = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage({
                type: 'addMessage',
                message: {
                    id: 55,
                    role: 'assistant',
                    origin: 'proactive',
                    proactiveEpisodeId: 'ep-c8-test',
                    content: 'Check your loop exit condition',
                    timestamp: Date.now(),
                },
            });
        });

        const dismissBtn = screen.getByRole('button', { name: 'Dismiss this suggestion' });
        fireEvent.click(dismissBtn);

        expect(mockApi.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'command',
                command: 'messageProactiveOutcome',
                payload: expect.objectContaining({
                    sessionId: 42,
                    messageId: 55,
                    outcome: 'DISMISSED',
                    proactiveEpisodeId: 'ep-c8-test',
                }),
            })
        );
    });

    it('Dismiss posts messageProactiveOutcome without proactiveEpisodeId when message has none (legacy)', async () => {
        useChatStore.setState(HYDRATED);
        const mockApi = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage({
                type: 'addMessage',
                message: {
                    id: 66,
                    role: 'assistant',
                    origin: 'proactive',
                    // no proactiveEpisodeId
                    content: 'Legacy hint without episode id',
                    timestamp: Date.now(),
                },
            });
        });

        const dismissBtn = screen.getByRole('button', { name: 'Dismiss this suggestion' });
        fireEvent.click(dismissBtn);

        // Should still post the command with the message fields
        expect(mockApi.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'command',
                command: 'messageProactiveOutcome',
                payload: expect.objectContaining({
                    messageId: 66,
                    outcome: 'DISMISSED',
                }),
            })
        );
        // proactiveEpisodeId should be undefined (not present) in the payload
        const calls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls as Array<[{ command?: string; payload?: { proactiveEpisodeId?: string } }]>;
        const outcomeCall = calls.find(([msg]) => msg.command === 'messageProactiveOutcome');
        expect(outcomeCall).toBeDefined();
        expect(outcomeCall![0].payload?.proactiveEpisodeId).toBeUndefined();
    });
});
