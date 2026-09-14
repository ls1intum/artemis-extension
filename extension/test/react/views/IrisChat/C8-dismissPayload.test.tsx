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

// A conversation the webview considers open AND hydrated: without both, the
// transcript stays behind the loader and no bubble is rendered at all.
const HYDRATED = {
    currentSessionId: 4711,
    loadedSessionId: 4711,
};

describe('C8: Dismiss payload includes proactiveEpisodeId', () => {
    beforeEach(() => {
        useChatStore.setState({
            exercises: [],
            courses: [],
            messages: [],
            suppressedIds: new Set(),
            foldStates: new Map(),
            liveEpisodeIds: new Set(),
            streaming: { isStreaming: false },
            isLoading: false,
            webSocketStatus: 'connected',
            disabledMessage: null,
            unavailableMessage: null,
            isNoAiDetected: false,
            referencedFiles: null,
            showDiagnostics: false,
            hasReceivedInitialIrisState: true,
            currentSessionId: 4711,
            loadedSessionId: 4711,
        });
    });

    it('Dismiss posts messageProactiveOutcome with proactiveEpisodeId from the message', async () => {
        useChatStore.setState(HYDRATED);
        const mockApi = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage({
                type: 'addMessage',
                sessionId: 4711,
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
                    sessionId: 4711,
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
                sessionId: 4711,
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
        const calls = (mockApi.postMessage as ReturnType<typeof vi.fn>).mock.calls as Array<[{ command?: string; payload?: { proactiveEpisodeId?: string } }]>;
        const outcomeCall = calls.find(([msg]) => msg.command === 'messageProactiveOutcome');
        expect(outcomeCall).toBeDefined();
        expect(outcomeCall![0].payload?.proactiveEpisodeId).toBeUndefined();
    });

    it('"Solved it" posts messageProactiveOutcome with outcome RECOVERED + proactiveEpisodeId', async () => {
        useChatStore.setState(HYDRATED);
        const mockApi = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={mockApi} />);

        await act(async () => {
            dispatchExtensionMessage({
                type: 'addMessage',
                sessionId: 4711,
                message: {
                    id: 88,
                    role: 'assistant',
                    origin: 'proactive',
                    proactiveEpisodeId: 'ep-solved',
                    content: 'Check your loop exit condition',
                    timestamp: Date.now(),
                },
            });
        });

        const solvedBtn = screen.getByRole('button', { name: 'Solved it' });
        fireEvent.click(solvedBtn);

        expect(mockApi.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'command',
                command: 'messageProactiveOutcome',
                payload: expect.objectContaining({
                    sessionId: 4711,
                    messageId: 88,
                    outcome: 'RECOVERED',
                    proactiveEpisodeId: 'ep-solved',
                }),
            })
        );
    });
});
