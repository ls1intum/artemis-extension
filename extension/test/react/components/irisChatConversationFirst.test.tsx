import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage, getPostMessageCalls } from '@test/react/__helpers__/vscodeApi';
import { useChatStore } from '@webview/stores/useChatStore';
import { ChatMessageList } from '@webview/views/IrisChat/components/ChatMessageList';
import { ChatNotice } from '@webview/views/IrisChat/components/ChatNotice';
import { ContextChip } from '@webview/views/IrisChat/components/ContextChip';
import { ContextPicker } from '@webview/views/IrisChat/components/ContextPicker';
import { ConversationHistory } from '@webview/views/IrisChat/components/ConversationHistory';
import { CoursePicker } from '@webview/views/IrisChat/components/CoursePicker';
import { IrisChatView } from '@webview/views/IrisChat/IrisChatView';

// Mock streamdown (ESM-only package)
vi.mock('streamdown', () => ({
    Streamdown: ({ children }: { children?: string }) => (
        <span data-testid="streamdown">{children}</span>
    ),
}));

// Mock use-stick-to-bottom (ESM package; must include scrollToBottom fn)
vi.mock('use-stick-to-bottom', () => ({
    useStickToBottom: vi.fn().mockReturnValue({
        scrollRef: { current: null },
        contentRef: { current: null },
        isAtBottom: true,
        scrollToBottom: vi.fn(),
    }),
}));

// Mock Shiki/CodeBlock to avoid dynamic imports
vi.mock('@webview/views/IrisChat/components/CodeBlock', () => ({
    CodeBlock: ({ children }: { language?: string; children?: string }) => (
        <pre><code>{children}</code></pre>
    ),
}));

const EX5 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 5, name: 'Recursion' };
const COURSE42 = { mode: 'COURSE_CHAT' as const, entityId: 42 };

const pickerProps = (over: Record<string, unknown> = {}) => ({
    courseId: 42,
    committedContext: COURSE42,
    pendingContext: undefined,
    contentState: 'content' as const,
    sendInFlight: false,
    exercises: [
        { id: 5, title: 'Recursion', courseId: 42 },
        { id: 7, title: 'Sorting', courseId: 42 },
    ],
    onSelect: vi.fn(),
    ...over,
});

describe('ContextChip', () => {
    it('calls the icon a removal while the conversation is empty, and acts on the click', async () => {
        // Empty means `resolveTopic` stages in place: the topic drops, nothing
        // is loaded, nothing is requested. That IS a removal.
        const onRemove = vi.fn();
        render(<ContextChip context={EX5} contentState="empty" onRemove={onRemove} onOpenPicker={vi.fn()} />);

        await userEvent.click(screen.getByRole('button', { name: 'Remove topic' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('keeps the icon, and the same promise, once the conversation has content', async () => {
        // `resolveTopic` stages in BOTH states, so the click means the same
        // thing in both and the wording may not differ. The icon staying is
        // also what keeps the chip from changing width mid-conversation.
        const onRemove = vi.fn();
        render(<ContextChip context={EX5} contentState="content" onRemove={onRemove} onOpenPicker={vi.fn()} />);

        await userEvent.click(screen.getByRole('button', { name: 'Remove topic' }));
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('disables the icon while the conversation is still loading', async () => {
        // `resolveTopic` refuses on `unknown`, so the click is swallowed. A
        // control that does nothing has to look like it.
        const onRemove = vi.fn();
        render(<ContextChip context={EX5} contentState="unknown" onRemove={onRemove} onOpenPicker={vi.fn()} />);

        const button = screen.getByRole('button', { name: 'Loading the conversation' });
        expect(button).toBeDisabled();
        await userEvent.click(button);
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('marks an exercise topic with the same icon the picker uses', () => {
        // Asserted on Lucide's own class, not on a test id: the claim is that
        // this is the File icon, the one the picker's exercise rows carry, and
        // a marker would survive swapping it for any other glyph.
        const { container } = render(
            <ContextChip context={EX5} contentState="content" onRemove={vi.fn()} onOpenPicker={vi.fn()} />,
        );
        expect(container.querySelector('.lucide-file')).not.toBeNull();
    });

    it('names a nameless topic by its entity, never the literal word "Topic"', () => {
        // What `_toSessionDetail` produces: `{ mode, entityId }`, no name. The
        // host fills one in from the tracked exercises when it has one; this is
        // the fallback for when it does not.
        render(
            <ContextChip
                context={{ mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 5 }}
                contentState="content"
                onRemove={vi.fn()}
                onOpenPicker={vi.fn()}
            />,
        );
        expect(screen.getByRole('button', { name: 'Exercise 5' })).toBeInTheDocument();
    });

    it('renders the course chat as clickable text rather than nothing at all', async () => {
        // Not a pill: a course chat is the absence of a topic, and a pill would
        // claim the same standing as a chosen exercise. Text still answers the
        // question the row exists to answer.
        const onOpenPicker = vi.fn();
        render(
            <ContextChip
                context={COURSE42}
                contentState="empty"
                courseTitle="Iris Conversation Test"
                onRemove={vi.fn()}
                onOpenPicker={onOpenPicker}
            />,
        );

        // The visible text is the course title, but the accessible name must not
        // be: the header's course button already carries that exact name and
        // goes somewhere else entirely.
        expect(screen.getByText('Iris Conversation Test')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Iris Conversation Test' })).toBeNull();

        const text = screen.getByRole('button', { name: /Change topic.*Iris Conversation Test/ });
        await userEvent.click(text);
        expect(onOpenPicker).toHaveBeenCalled();
    });

    it('offers nothing to remove on a course chat', () => {
        // There is no topic to take away, so neither wording may appear.
        render(
            <ContextChip
                context={COURSE42}
                contentState="empty"
                courseTitle="Iris Conversation Test"
                onRemove={vi.fn()}
                onOpenPicker={vi.fn()}
            />,
        );
        expect(screen.queryByRole('button', { name: 'Remove topic' })).toBeNull();
    });

    it('falls back to the generic course label when the host knows no title', () => {
        render(
            <ContextChip context={COURSE42} contentState="empty" onRemove={vi.fn()} onOpenPicker={vi.fn()} />,
        );
        expect(screen.getByText('Course chat')).toBeInTheDocument();
    });
});

describe('IrisChatView offers exactly one Retry', () => {
    const withConversation = {
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 1,
        contentState: 'content' as const,
    };

    /** Brings the view into "Iris is unreachable and my message did not go out". */
    const failedUnderBanner = (api: ReturnType<typeof createMockVsCodeApi>) => {
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withConversation });
        act(() => {
            useChatStore.getState().addMessage({
                localId: 'local-1', role: 'user', content: 'hallo123', timestamp: 1, status: 'sending',
            });
            useChatStore.getState().markMessageFailed('local-1', 'Iris is temporarily unavailable.', 'iris-unavailable');
        });
        dispatchExtensionMessage({ type: 'showUnavailableState', message: 'Iris is temporarily unavailable. Retry to reload.' });
    };

    it('shows the message its own Retry and no second one in the banner', async () => {
        // Two Retry buttons at once, one of them dead, is a puzzle rather than
        // an affordance. The failed message carries the text, so its button is
        // the one that survives, and it takes over the reload as well.
        const api = createMockVsCodeApi();
        failedUnderBanner(api);

        expect(await screen.findByText(/temporarily unavailable\. Retry to reload/)).toBeInTheDocument();
        // The two carry different accessible names, so counting one name would
        // have missed the other entirely. Count every Retry there is.
        const retries = screen.getAllByRole('button').filter(b => /retry/i.test(b.textContent ?? ''));
        expect(retries).toHaveLength(1);
        expect(retries[0]).toHaveAccessibleName('Retry sending this message');
        expect(retries[0]).toBeEnabled();
    });

    it('keeps the banner Retry when the only failed message cannot reload', async () => {
        // An `iris-disabled` bubble keeps a Retry that stays disabled. Hiding
        // the banner's for its sake would leave no enabled way back at all.
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withConversation });
        act(() => {
            useChatStore.getState().addMessage({
                localId: 'local-1', role: 'user', content: 'hallo123', timestamp: 1, status: 'sending',
            });
            useChatStore.getState().markMessageFailed('local-1', 'Iris is disabled here.', 'iris-disabled');
        });
        dispatchExtensionMessage({ type: 'showUnavailableState', message: 'Iris is temporarily unavailable. Retry to reload.' });

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    });

    it('keeps the banner Retry when there is no failed message to carry one', async () => {
        // Without it there would be no way back at all: only a reload re-runs
        // the availability check.
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withConversation });
        dispatchExtensionMessage({ type: 'showUnavailableState', message: 'Iris is temporarily unavailable. Retry to reload.' });

        expect(await screen.findByRole('button', { name: 'Retry' })).toBeEnabled();
    });

    it('reloads first and sends nothing yet', async () => {
        // Resending into a dead connection would only fail again. The reload is
        // the only thing that re-runs the availability check.
        const api = createMockVsCodeApi();
        failedUnderBanner(api);

        await userEvent.click(await screen.findByRole('button', { name: 'Retry sending this message' }));

        const commands = getPostMessageCalls(api).map(c => (c[0] as { command?: string }).command);
        expect(commands).toContain('reloadChatSession');
        expect(commands).not.toContain('sendMessage');
    });

    it('sends the message once the reload has cleared the banner', async () => {
        // The event order is the PRODUCTION one and it is load-bearing: a
        // successful reload delivers the server transcript BEFORE it clears the
        // banner, and that transcript replaces the message array, taking the
        // unsent local bubble with it. Remembering only its localId would leave
        // nothing to look up, and the resend would be silently dropped.
        const api = createMockVsCodeApi();
        failedUnderBanner(api);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry sending this message' }));

        dispatchExtensionMessage({
            type: 'loadMessages',
            sessionId: 900,
            messages: [{ id: 7, role: 'assistant', content: 'from the server', timestamp: 2 }],
        });
        dispatchExtensionMessage({ type: 'hideUnavailableState' });

        await waitFor(() => {
            const sends = getPostMessageCalls(api)
                .map(c => c[0] as { command?: string; payload?: { text?: string } })
                .filter(c => c.command === 'sendMessage');
            expect(sends).toHaveLength(1);
            expect(sends[0].payload?.text).toBe('hallo123');
        });
    });

    it('abandons the resend when the reload landed in another conversation', async () => {
        // The banner also clears on a navigation. Sending the remembered text
        // into whatever is open now would put the student's words in a
        // conversation they were never writing in.
        const api = createMockVsCodeApi();
        failedUnderBanner(api);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry sending this message' }));

        // PRODUCTION ORDER: the host hides the banner and only then publishes
        // the new snapshot, so at the moment the effect runs the webview still
        // reports the old conversation. A send may therefore go out, and it is
        // addressed to THAT conversation, because the send reads the session
        // from the same snapshot the cancellation check compared. The host
        // refuses it by origin. What must never happen is a send carrying the
        // conversation the student never wrote in.
        dispatchExtensionMessage({ type: 'hideUnavailableState' });
        dispatchExtensionMessage({ type: 'updateIrisState', state: { ...withConversation, currentSessionId: 901 } });

        // Flushed, not `waitFor`ed: waiting for an ABSENCE passes on the first
        // tick, before the effect under test could have done anything at all.
        await act(async () => { await Promise.resolve(); });

        const sends = getPostMessageCalls(api)
            .map(c => c[0] as { command?: string; payload?: { sessionId?: number } })
            .filter(c => c.command === 'sendMessage');
        for (const send of sends) {
            expect(send.payload?.sessionId).toBe(900);
        }
    });

    it('cancels outright when the move is already visible', async () => {
        // The other order, which a slower navigation produces. Here there is
        // nothing to address the send to any more, so none is posted at all.
        const api = createMockVsCodeApi();
        failedUnderBanner(api);
        await userEvent.click(await screen.findByRole('button', { name: 'Retry sending this message' }));

        dispatchExtensionMessage({ type: 'updateIrisState', state: { ...withConversation, currentSessionId: 901 } });
        dispatchExtensionMessage({ type: 'hideUnavailableState' });
        await act(async () => { await Promise.resolve(); });

        const sends = getPostMessageCalls(api)
            .map(c => c[0] as { command?: string })
            .filter(c => c.command === 'sendMessage');
        expect(sends).toHaveLength(0);
    });
});

describe('IrisChatView when Iris is temporarily unavailable', () => {
    const withTranscript = {
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 2,
        contentState: 'content' as const,
    };

    it('keeps the transcript on screen behind the banner', async () => {
        // `unavailable` is the TRANSIENT state, offered with a Retry. Blanking
        // the list throws away what the student was reading because the server
        // hiccupped, and the messages are still in the store: the header goes on
        // counting them. Every other failure path in this model leaves the open
        // conversation exactly as it was.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withTranscript });
        dispatchExtensionMessage({
            type: 'addMessage',
            sessionId: 900,
            message: { id: 1, role: 'user', content: 'still readable', timestamp: 1 },
        });

        dispatchExtensionMessage({ type: 'showUnavailableState', message: 'Iris is temporarily unavailable. Retry to reload.' });

        expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument();
        expect(screen.getByText('still readable')).toBeInTheDocument();
    });

    it('still blanks it when Iris is switched OFF, where there is nothing to show', async () => {
        // The counterpart, and why the two cannot share a branch: a disabled
        // course has no conversation at all.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withTranscript });
        dispatchExtensionMessage({
            type: 'addMessage',
            sessionId: 900,
            message: { id: 1, role: 'user', content: 'still readable', timestamp: 1 },
        });

        dispatchExtensionMessage({ type: 'showDisabledState', message: 'Iris chat is not enabled for this course.' });

        expect(await screen.findByText(/not enabled for this course/)).toBeInTheDocument();
        expect(screen.queryByText('still readable')).toBeNull();
    });
});

describe('IrisChatView in a course whose Iris is switched off', () => {
    const disabledCourse = {
        exercises: [],
        courses: [{ id: 9027, title: 'Iris Disabled Course' }],
        courseId: 9027,
        courseTitle: 'Iris Disabled Course',
        currentSessionId: null,
        contentState: 'unknown' as const,
    };

    it('closes the course picker even though no conversation id changed', async () => {
        // Both the course we left and the one we entered have no conversation,
        // so `currentSessionId` stays null and the popover's usual success
        // signal never fires. Leaving it open would park the picker on top of
        // the banner that explains where the student now is.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...disabledCourse, courseId: 9026, courseTitle: 'Iris Conversation Test' },
        });
        await userEvent.click(await screen.findByRole('button', { name: /Iris Conversation Test/ }));
        expect(screen.getByRole('dialog', { name: 'Select course' })).toBeInTheDocument();

        dispatchExtensionMessage({ type: 'updateIrisState', state: disabledCourse });

        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Select course' })).toBeNull());
    });

    it('says Iris is off rather than telling the student to choose a course', async () => {
        // Entering such a course is a destination now, so the panel is legitimately
        // conversation-less. "Choose a course to start chatting" would send the
        // student back to a picker they have just used, past a banner that
        // already states the real reason.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: disabledCourse });
        dispatchExtensionMessage({
            type: 'showDisabledState',
            message: 'Iris chat is not enabled for this course. Please contact your instructor.',
        });

        expect(await screen.findByText(/not enabled for this course/)).toBeInTheDocument();
        const input = screen.getByPlaceholderText(/./) as HTMLTextAreaElement;
        expect(input.placeholder).not.toMatch(/choose a course/i);
    });
});

describe('IrisChatView names the course chat on the composer', () => {
    it('passes the real course title down, not the generic fallback', async () => {
        // Pins the prop, not just the component: without the wiring in
        // IrisChatView the chip silently degrades to the literal words
        // "Course chat" and every component test above still passes.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: {
                exercises: [],
                courses: [{ id: 42, title: 'Introduction to Computer Science' }],
                courseId: 42,
                courseTitle: 'Introduction to Computer Science',
                currentSessionId: 900,
                conversationTitle: 'General questions',
                displayMessageCount: 2,
                contentState: 'content' as const,
                committedContext: { mode: 'COURSE_CHAT', entityId: 42 },
            },
        });

        expect(
            await screen.findByRole('button', {
                name: 'Change topic, currently the whole course: Introduction to Computer Science',
            }),
        ).toBeInTheDocument();
        expect(screen.queryByText('Course chat')).toBeNull();
    });
});

describe('ContextPicker (topic picker)', () => {
    it('promises no conversation change, in either content state', () => {
        // A pick always stages into the OPEN conversation now, so a warning
        // about opening another one describes something that cannot happen.
        for (const contentState of ['content', 'empty'] as const) {
            const { unmount } = render(<ContextPicker {...pickerProps({ contentState })} />);
            expect(screen.queryByText(/different conversation/)).toBeNull();
            unmount();
        }
    });

    it('disables every picker entry while the content state is unknown', () => {
        render(<ContextPicker {...pickerProps({ contentState: 'unknown' })} />);
        for (const id of [5, 7]) {
            expect(screen.getByTestId(`picker-entry-${id}`)).toBeDisabled();
        }
        expect(screen.getByTestId('picker-entry-course')).toBeDisabled();
    });

    it('disables every picker entry while a send is in flight', () => {
        render(<ContextPicker {...pickerProps({ sendInFlight: true })} />);
        expect(screen.getByTestId('picker-entry-5')).toBeDisabled();
    });
});

describe('ConversationHistory (conversation list)', () => {
    it('lists a lecture conversation in the history but not in the picker', () => {
        const lecture = {
            sessionId: 12,
            courseId: 42,
            mode: 'LECTURE_CHAT',
            entityId: 3,
            entityName: 'Week 3',
            lastActivity: 200,
        };
        const history = render(
            <ConversationHistory conversations={[lecture]} currentSessionId={9} onOpen={vi.fn()} nowMs={300} />,
        );
        expect(screen.getByText('Week 3')).toBeInTheDocument();
        // Unmounted before the second render: both would otherwise live in the
        // same document and the picker assertion below could never fail.
        history.unmount();

        render(<ContextPicker {...pickerProps()} />);
        expect(screen.queryByText('Week 3')).toBeNull();
    });
});

describe('ChatMessageList (transcript)', () => {
    // The brief's snippets pass three props. The component's live-run props
    // are required on purpose (a caller that forgets `hasContext` must get a
    // type error, not the wrong welcome copy), so the fixture supplies them.
    const listProps = {
        streaming: { isStreaming: false },
        activities: [],
        liveDraft: null,
        runState: null,
        runError: null,
        onFeedback: vi.fn(),
        onSendPrompt: vi.fn(),
        hasContext: true,
    };

    it('renders a stored marker row in transcript order, before the message it triggered', () => {
        render(<ChatMessageList
            {...listProps}
            messages={[
                { localId: 'm', role: 'contextSwap', content: 'Topic set to Sorting', timestamp: 1 },
                { localId: 'u', role: 'user', content: 'hello', timestamp: 2 },
            ]}
        />);
        const rows = screen.getAllByTestId('message-row');
        expect(rows[0]).toHaveTextContent('Topic set to Sorting');
        expect(rows[1]).toHaveTextContent('hello');
    });
});

describe('ChatNotice', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('clears the notice when the open conversation changes', () => {
        const { rerender } = render(
            <ChatNotice
                notice={{ text: 'Switched to a different conversation.' }}
                currentSessionId={1}
                onExpire={vi.fn()}
            />,
        );
        expect(screen.getByText('Switched to a different conversation.')).toBeInTheDocument();
        rerender(<ChatNotice notice={undefined} currentSessionId={9} onExpire={vi.fn()} />);
        expect(screen.queryByText('Switched to a different conversation.')).toBeNull();
    });

    it('asks to be cleared as soon as the conversation changes under it', () => {
        // A notice is cleared by ANY navigation, not only by its own timeout:
        // it describes a situation the student has since left.
        const onExpire = vi.fn();
        const { rerender } = render(
            <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={1} onExpire={onExpire} />,
        );
        expect(onExpire).not.toHaveBeenCalled();

        rerender(
            <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={2} onExpire={onExpire} />,
        );
        expect(onExpire).toHaveBeenCalled();
    });

    it('asks to be cleared after ten seconds', () => {
        vi.useFakeTimers();
        const onExpire = vi.fn();
        render(
            <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={1} onExpire={onExpire} />,
        );

        vi.advanceTimersByTime(9_999);
        expect(onExpire).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('still expires when the parent re-renders throughout the ten seconds', () => {
        // The real caller passes an inline arrow and re-renders on every store
        // change, which now includes every keystroke in the composer. If the
        // timeout depended on that identity it would restart on each render and
        // the notice would sit there for as long as the student keeps typing.
        vi.useFakeTimers();
        const onExpire = vi.fn();
        const { rerender } = render(
            <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={1} onExpire={() => onExpire()} />,
        );

        for (let elapsed = 0; elapsed < 10_000; elapsed += 1_000) {
            vi.advanceTimersByTime(1_000);
            rerender(
                <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={1} onExpire={() => onExpire()} />,
            );
        }

        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('states an error-toned notice assertively, not as a muted aside', () => {
        // The refusal surface for the two navigations that have no popover.
        // Rendering it in the informational style would say "here is what
        // happened" about a click that did nothing.
        render(
            <ChatNotice
                notice={{ text: 'Could not change the topic. Please try again.', tone: 'error' }}
                currentSessionId={1}
                onExpire={vi.fn()}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Could not change the topic.');
    });

    it('keeps an untoned notice informational', () => {
        render(
            <ChatNotice notice={{ text: 'Started a new conversation.' }} currentSessionId={1} onExpire={vi.fn()} />,
        );
        expect(screen.getByRole('status')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('never renders an action, on any notice', () => {
        // Cut 2: the notice is actionless in PR 1. Undo returns with PR 2.
        render(
            <ChatNotice notice={{ text: 'Your staged topic was discarded.' }} currentSessionId={1} onExpire={vi.fn()} />,
        );
        expect(screen.queryByRole('button')).toBeNull();
    });
});

describe('CoursePicker', () => {
    it('shows a loading state instead of an empty result while the course list is still being fetched', () => {
        // An empty list only means "no courses" once something has actually
        // looked. Until then the picker must not answer the question.
        render(<CoursePicker courses={[]} currentCourseId={null} status="loading" onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByText('No courses found')).toBeNull();
    });

    it('states an empty result explicitly once the list is ready', () => {
        render(<CoursePicker courses={[]} currentCourseId={null} status="ready" onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('No courses found')).toBeInTheDocument();
    });

    it('keeps focus on the row the student is on when a refresh fails under their hands', async () => {
        const courses = [{ id: 42, title: 'Algorithms' }, { id: 43, title: 'Databases' }];
        const { rerender } = render(
            <CoursePicker courses={courses} currentCourseId={null} status="ready" onSelect={vi.fn()} onClose={vi.fn()} />,
        );
        const second = screen.getByTestId('course-entry-43');
        second.focus();
        expect(document.activeElement).toBe(second);

        // The refresh the open picker fired comes back a failure. The list is
        // unchanged, so the only thing that moves is the notice appearing.
        rerender(
            <CoursePicker courses={courses} currentCourseId={null} status="stale" onSelect={vi.fn()} onClose={vi.fn()} onRetry={vi.fn()} />,
        );

        expect(await screen.findByText(/Could not refresh your courses/)).toBeInTheDocument();
        expect(document.activeElement).toBe(second);
    });

    it('renders a failed course switch as an inline banner', () => {
        render(
            <CoursePicker
                courses={[{ id: 42, title: 'Algorithms' }]}
                currentCourseId={null}
                openError="Could not open that course. Please try again."
                onSelect={vi.fn()}
                onClose={vi.fn()}
            />,
        );
        expect(screen.getByRole('alert')).toHaveTextContent('Could not open that course.');
    });

    it('renders no alert banner when there is no error', () => {
        render(<CoursePicker courses={[]} currentCourseId={null} onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.queryByRole('alert')).toBeNull();
    });

    // The fresh-install path: the picker opens with nothing in it, so there is
    // no focusable child. With focus left outside the dialog, the key handler
    // ON the dialog never sees a key at all.
    it('holds focus while it is still loading, so Escape reaches it', async () => {
        const onClose = vi.fn();
        render(<CoursePicker courses={[]} currentCourseId={null} status="loading" onSelect={vi.fn()} onClose={onClose} />);
        const dialog = screen.getByRole('dialog');

        expect(dialog.contains(document.activeElement)).toBe(true);
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('moves focus onto the first row once the rows arrive', () => {
        const { rerender } = render(
            <CoursePicker courses={[]} currentCourseId={null} status="loading" onSelect={vi.fn()} onClose={vi.fn()} />,
        );
        rerender(
            <CoursePicker
                courses={[{ id: 42, title: 'Algorithms' }]}
                currentCourseId={null}
                status="ready"
                onSelect={vi.fn()}
                onClose={vi.fn()}
            />,
        );

        // A one-shot effect cannot do this: it ran when there was nothing to
        // focus and never runs again.
        expect(document.activeElement).toBe(screen.getByTestId('course-entry-42'));
    });
});

// The failure this pins is a WRITE-ONLY channel: three live host paths post
// `openSessionError`, the store holds it, and nothing rendered it. A student
// whose navigation failed saw a popover sitting there showing nothing.
describe('IrisChatView surfaces a failed navigation', () => {
    const activeState = {
        exercises: [],
        courses: [
            { id: 42, title: 'Introduction to Computer Science' },
            { id: 43, title: 'Algorithms' },
        ],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 8,
        contentState: 'content' as const,
        conversations: [{
            sessionId: 901,
            courseId: 42,
            mode: 'PROGRAMMING_EXERCISE_CHAT',
            entityId: 7,
            entityName: 'Sorting',
            title: 'Earlier question',
            lastActivity: 100,
        }],
    };

    it('shows the error inside the history popover, which stays open to hold it', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));
        await userEvent.click(screen.getByText('Earlier question'));

        // The host answers the failed open. The popover must still be mounted.
        dispatchExtensionMessage({
            type: 'openSessionError',
            message: 'Could not open that conversation. Please try again.',
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not open that conversation.');
        expect(screen.getByRole('dialog', { name: 'Conversations' })).toBeInTheDocument();
    });

    it('shows the error inside the course picker, which stays open to hold it', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        await userEvent.click(screen.getByRole('button', { name: /Introduction to Computer Science/ }));
        await userEvent.click(screen.getByTestId('course-entry-43'));

        dispatchExtensionMessage({
            type: 'openSessionError',
            message: 'Could not open that course. Please try again.',
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not open that course.');
        expect(screen.getByRole('dialog', { name: 'Select course' })).toBeInTheDocument();
    });

    // `currentSessionId` is legitimately null whenever nothing is open (a
    // failed acquisition, Iris unavailable), and the header and both popovers
    // still render then, so a guard that reads null as "no popover is open"
    // never fires and the popover stays mounted over the conversation that
    // did load, still showing the previous failure.
    it('closes the history popover on a navigation started from a null session', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: undefined, conversationTitle: undefined },
        });
        await screen.findByRole('button', { name: 'View past conversations' });

        await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));
        await userEvent.click(screen.getByText('Earlier question'));
        expect(screen.getByRole('dialog', { name: 'Conversations' })).toBeInTheDocument();

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: 901, conversationTitle: 'Earlier question' },
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Conversations' })).toBeNull();
        });
    });

    it('closes the course picker on a navigation started from a null session', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: undefined, conversationTitle: undefined },
        });
        await screen.findByRole('button', { name: /Introduction to Computer Science/ });

        await userEvent.click(screen.getByRole('button', { name: /Introduction to Computer Science/ }));
        await userEvent.click(screen.getByTestId('course-entry-43'));
        expect(screen.getByRole('dialog', { name: 'Select course' })).toBeInTheDocument();

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, courseId: 43, courseTitle: 'Algorithms', currentSessionId: 902 },
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Select course' })).toBeNull();
        });
    });

    it('a successful retry leaves no stale failure banner behind', async () => {
        // The first switch fails and the banner appears. The student picks a
        // different course, that one succeeds, and the failure message must
        // not survive on top of the conversation that did load.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: undefined, conversationTitle: undefined },
        });
        await screen.findByRole('button', { name: /Introduction to Computer Science/ });

        await userEvent.click(screen.getByRole('button', { name: /Introduction to Computer Science/ }));
        await userEvent.click(screen.getByTestId('course-entry-43'));
        dispatchExtensionMessage({
            type: 'openSessionError',
            message: 'Could not open that course. Please try again.',
        });
        expect(await screen.findByRole('alert')).toHaveTextContent('Could not open that course.');

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, courseId: 43, courseTitle: 'Algorithms', currentSessionId: 902 },
        });

        await waitFor(() => {
            expect(screen.queryByRole('alert')).toBeNull();
        });
        expect(screen.queryByRole('dialog', { name: 'Select course' })).toBeNull();
    });

    it('a fresh course picker does not inherit a send-path error', async () => {
        // `reportError` names a send, not a course. Only `openHistory` used to
        // clear the field, so a send-path error could ONLY ever surface here,
        // wearing the wrong context entirely.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        dispatchExtensionMessage({
            type: 'openSessionError',
            message: 'Iris could not be reached. The transcript may be out of date.',
        });

        await userEvent.click(screen.getByRole('button', { name: /Introduction to Computer Science/ }));

        expect(screen.getByRole('dialog', { name: 'Select course' })).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('renders a refused navigation as an error, tone and all', async () => {
        // THE WIRE, not the component. The host is the only producer of
        // `tone`, and a message handler that drops it leaves the error style
        // and `role="alert"` unreachable in production while every
        // component-level test still passes.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        dispatchExtensionMessage({
            type: 'showChatNotice',
            text: 'Could not change the topic. Please try again.',
            tone: 'error',
        });

        expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the topic.');
    });

    it('closes the TOPIC picker when the conversation changes underneath it', async () => {
        // Not merely focus theft. With the picker open on course 42, a
        // navigation the student did not start (an Ask-Iris command from the
        // dashboard) re-scopes the rows to course 43, and the row they were
        // aiming at now stages a different course's exercise.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        await userEvent.click(screen.getByRole('button', { name: 'Choose topic' }));
        expect(screen.getByRole('dialog', { name: 'Select topic' })).toBeInTheDocument();

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, courseId: 43, courseTitle: 'Algorithms', currentSessionId: 902 },
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Select topic' })).toBeNull();
        });
    });

    it('clears the failure when the popover closes, not merely on the next open', async () => {
        // Both openers clear `openSessionError` themselves, so a test that
        // only re-opens a popover passes with the clear in `closePopovers`
        // deleted. The store is where the deletion is actually visible.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));
        await userEvent.click(screen.getByText('Earlier question'));
        dispatchExtensionMessage({
            type: 'openSessionError',
            message: 'Could not open that conversation. Please try again.',
        });
        expect(await screen.findByRole('alert')).toBeInTheDocument();

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: 901, conversationTitle: 'Earlier question' },
        });

        await waitFor(() => {
            expect(useChatStore.getState().openSessionError).toBeNull();
        });
    });

    it('closes the popover once the navigation actually lands', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByText(/BFS loop/);

        await userEvent.click(screen.getByRole('button', { name: 'View past conversations' }));
        await userEvent.click(screen.getByText('Earlier question'));
        expect(screen.getByRole('dialog', { name: 'Conversations' })).toBeInTheDocument();

        // The conversation changing IS the success signal.
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, currentSessionId: 901, conversationTitle: 'Earlier question' },
        });

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Conversations' })).toBeNull();
        });
    });
});

describe('IrisChatView header', () => {
    // EXACTLY what `chatViewStatePresenter` puts on the wire in a logged-in
    // session with no conversation open yet.
    const hostShapeToday = {
        exercises: [{ id: 5, title: 'Recursion', courseId: 42 }],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        workspaceExerciseId: 5,
        courseId: undefined,
        courseTitle: undefined,
        currentSessionId: undefined,
        conversationTitle: undefined,
        displayMessageCount: 0,
        committedContext: undefined,
        pendingContext: undefined,
        contentState: 'unknown' as const,
        sendInFlight: false,
        navigationInFlight: false,
        conversations: [],
    };

    it('renders the course and conversation lines from the conversation fields', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: {
                ...hostShapeToday,
                courseId: 42,
                courseTitle: 'Introduction to Computer Science',
                currentSessionId: 900,
                conversationTitle: 'BFS loop',
                displayMessageCount: 8,
                contentState: 'content' as const,
            },
        });

        expect(await screen.findByText(/BFS loop · 8 messages/)).toBeInTheDocument();
        // Line 1 is a button, and it is the only clickable part of the header.
        expect(screen.getByRole('button', { name: /Introduction to Computer Science/ })).toBeInTheDocument();
    });

    describe('posts only conversation-first commands', () => {
        // Every one of the four paths, not just the topic pick: the retired
        // command names are gone from the contract, and a build that resurrected
        // one would post a command no handler answers. This invariant has
        // already been reversed twice, so all four are pinned.
        const activeState = {
            ...hostShapeToday,
            courseId: 42,
            courseTitle: 'Introduction to Computer Science',
            currentSessionId: 900,
            conversationTitle: 'BFS loop',
            displayMessageCount: 8,
            contentState: 'content' as const,
            // A second course and a second conversation, so the controls below
            // land on a row that is NOT the current one: clicking the current
            // row is defined as "just close", which would post nothing and let
            // the assertions pass without exercising anything.
            courses: [
                { id: 42, title: 'Introduction to Computer Science' },
                { id: 43, title: 'Algorithms' },
            ],
            conversations: [{
                sessionId: 901,
                courseId: 42,
                mode: 'PROGRAMMING_EXERCISE_CHAT',
                entityId: 7,
                entityName: 'Sorting',
                title: 'Earlier question',
                lastActivity: 100,
            }],
        };

        const paths = [
            {
                what: 'a topic is picked',
                act: async () => {
                    await userEvent.click(await screen.findByRole('button', { name: 'Choose topic' }));
                    await userEvent.click(screen.getByTestId('picker-entry-5'));
                },
                posts: 'selectTopic',
                neverPosts: 'selectChatContext',
            },
            {
                what: 'a new conversation is started',
                act: async () => {
                    await userEvent.click(await screen.findByRole('button', { name: 'New conversation' }));
                },
                posts: 'newConversation',
                neverPosts: 'createNewSession',
            },
            {
                what: 'the course is switched',
                act: async () => {
                    await userEvent.click(
                        await screen.findByRole('button', { name: /Introduction to Computer Science/ }),
                    );
                    await userEvent.click(screen.getByTestId('course-entry-43'));
                },
                posts: 'switchCourse',
                neverPosts: 'selectChatContext',
            },
            {
                what: 'another conversation is opened',
                act: async () => {
                    await userEvent.click(await screen.findByRole('button', { name: 'View past conversations' }));
                    await userEvent.click(screen.getByText('Earlier question'));
                },
                posts: 'openConversation',
                neverPosts: 'openArtemisSession',
            },
        ];

        for (const { what, act, posts, neverPosts } of paths) {
            it(`when ${what}`, async () => {
                const api = createMockVsCodeApi();
                render(<IrisChatView vscodeApi={api} />);
                dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });

                await screen.findByText(/BFS loop · 8 messages/);

                await act();

                const commands = getPostMessageCalls(api).map(([msg]) => (msg as { command?: string }).command);
                expect(commands).toContain(posts);
                expect(commands).not.toContain(neverPosts);
            });
        }
    });
});

describe('IrisChatView cold start', () => {
    // The brief writes this as `render(<IrisChatView state={{...}} />)`, which
    // the component has never accepted: it reads the store and takes only
    // `vscodeApi`. The state is therefore delivered the way the host delivers
    // it, through an `updateIrisState` snapshot; the assertion is unchanged.
    const coldStartState = {
        exercises: [],
        courses: [],
        contentState: 'unknown' as const,
    };

    it('offers the course list on cold start instead of an empty transcript', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: coldStartState });

        expect(await screen.findByText(/No Artemis workspace detected/)).toBeInTheDocument();
    });

    it('renders no header on cold start', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: coldStartState });

        await screen.findByText(/No Artemis workspace detected/);
        expect(screen.queryByRole('button', { name: 'View past conversations' })).toBeNull();
    });
});

/**
 * Task 8: `isColdStart` used to fire the instant a snapshot said "nothing is
 * open", which is exactly when workspace detection is still running. These
 * pin the two states that keep the chooser from appearing prematurely (or at
 * all, when the server cannot be reached), plus the guard that stops a failed
 * background detection from covering an unrelated course's own banner.
 */
describe('IrisChatView waits for workspace detection before offering the course list', () => {
    const nothingOpen = {
        exercises: [],
        courses: [],
        contentState: 'unknown' as const,
        courseId: undefined,
        currentSessionId: undefined,
        workspaceExerciseId: undefined,
    };

    it('the course chooser waits for detection to settle', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...nothingOpen, detectionState: 'unsettled' },
        });

        // Awaited, not a synchronous query: `dispatchExtensionMessage` fires a
        // DOM event outside of React's own event handling, so the state
        // update is not guaranteed to have flushed by the next line. The
        // waiting copy is this state's own signature, and finding it also
        // proves the assertion below is not just reading the pre-dispatch
        // frame.
        expect(await screen.findByText(/looking for your artemis exercise/i)).toBeInTheDocument();
        expect(screen.queryByText(/choose a course/i)).toBeNull();
        // The composer is a second surface with its own "choose a course"
        // fallback (IrisChatView.tsx, the `!hasConversation` placeholder
        // branch): a spinner in the message area is not enough if the input
        // right below it still tells the student to pick a course.
        const input = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
        expect(input.placeholder).toMatch(/looking for your artemis exercise/i);
        expect(input.placeholder).not.toMatch(/choose a course/i);

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...nothingOpen, detectionState: 'settled' },
        });

        expect(await screen.findByText(/choose a course/i)).toBeInTheDocument();
    });

    it('an unreachable server offers a retry instead of the chooser', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...nothingOpen, detectionState: 'unavailable' },
        });

        const retryButton = await screen.findByRole('button', { name: /^retry$/i });
        // The chooser ITSELF (the picker dialog) must not be showing — the
        // outage screen also carries a "Choose a course instead" escape
        // hatch (see the dedicated test below), whose own label contains the
        // words "choose a course", so a text-based query is not precise
        // enough here.
        expect(screen.queryByRole('dialog', { name: 'Select course' })).toBeNull();
        // The ordinary header must stay suppressed too: it falls back to a
        // "Choose a course" button whenever no course is open, which is not
        // true yet while detection is still unavailable. Exact string, not a
        // pattern: "Choose a course instead" (the outage screen's own escape
        // hatch) must NOT satisfy this query, so a text-based match would
        // hide a regression here behind that other button's presence.
        expect(screen.queryByRole('button', { name: 'Choose a course' })).toBeNull();
        // Same composer surface, same trap: without its own branch, the
        // `!hasConversation` fallback would say "Choose a course to start
        // chatting" here too, which is simply false while detection has not
        // been able to answer.
        const input = screen.getByRole('textbox', { name: 'Chat input' }) as HTMLTextAreaElement;
        expect(input.placeholder).toMatch(/detecting your artemis exercise failed/i);
        expect(input.placeholder).not.toMatch(/choose a course/i);
        await userEvent.click(retryButton);

        expect(
            getPostMessageCalls(api).some(([m]) => (m as { command?: string }).command === 'retryStartupDetection'),
        ).toBe(true);
    });

    it('the outage screen offers a second way to the course chooser, so Retry is not the only way out', async () => {
        // Detection can fail identically on every retry (e.g. an
        // archived-courses lookup that keeps throwing), which would strand a
        // student behind the outage screen forever even though their courses
        // are already sitting in the store from an earlier dashboard fetch.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...nothingOpen, detectionState: 'unavailable' },
        });

        const chooseInstead = await screen.findByRole('button', { name: /choose a course instead/i });
        // Retry is still there, unchanged: this is a second way out, not a
        // replacement for it.
        expect(screen.getByRole('button', { name: /^retry$/i })).toBeInTheDocument();

        await userEvent.click(chooseInstead);

        expect(await screen.findByText(/choose a course/i)).toBeInTheDocument();
    });

    it('a disabled course keeps its banner when detection fails behind it', async () => {
        // The banner comes from `showDisabledState`, not from the view-state
        // snapshot: a snapshot with a course and no session sets no
        // `disabledMessage` at all, so establishing it first is what makes
        // this test about the interaction rather than about an empty screen.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({
            type: 'showDisabledState',
            message: 'Iris chat is not enabled for this course.',
        });
        // courseId set, no session: exactly what entering an Iris-disabled
        // course produces (#375). `unavailable` then arrives from a
        // background detection that has nothing to do with that course.
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: {
                exercises: [],
                courses: [{ id: 42, title: 'Iris Disabled Course' }],
                courseId: 42,
                courseTitle: 'Iris Disabled Course',
                currentSessionId: undefined,
                contentState: 'unknown' as const,
                detectionState: 'unavailable',
            },
        });

        // Awaited first, so the second snapshot's re-render has genuinely
        // flushed before the retry-button check below: `dispatchExtensionMessage`
        // fires a DOM event outside of React's own event handling, and a
        // synchronous query here would otherwise risk reading the frame from
        // before that snapshot landed, passing regardless of what it rendered.
        expect(await screen.findByText(/not enabled for this course/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
    });
});

describe('IrisChatView course refresh', () => {
    const coldStartState = {
        exercises: [],
        courses: [],
        contentState: 'unknown' as const,
    };

    it('asks the host for the course list on a cold start and shows a loading list until it answers', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: coldStartState });

        await screen.findByText(/No Artemis workspace detected/);
        expect(getPostMessageCalls(api).some(([m]) => (m as { command?: string }).command === 'refreshCourses')).toBe(true);
        // Loading, NOT "No courses found": nothing is tracked on a fresh
        // installation, so an empty list means nothing until the fetch lands.
        expect(screen.getByRole('dialog', { name: 'Select course' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByText('No courses found')).toBeNull();
    });

    // The cold-start effect asks unconditionally now, rather than only when
    // the list happens to be empty. This is the case that distinguishes the
    // two: the very first snapshot that flips the cold start on already
    // carries courses, left over from an earlier dashboard fetch. Skipping the
    // refresh there is exactly how a course deleted on the server survives in
    // the chooser, which is the defect this branch exists to remove.
    it('still asks the host for courses when the cold start opens with a list already in hand', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...coldStartState, courses: [{ id: 42, title: 'Stale but present' }] },
        });

        await screen.findByText(/No Artemis workspace detected/);
        expect(getPostMessageCalls(api).some(([m]) => (m as { command?: string }).command === 'refreshCourses')).toBe(true);
    });

    it('lists the courses once the host answers with a snapshot', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: coldStartState });
        await screen.findByText(/No Artemis workspace detected/);

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...coldStartState, courses: [{ id: 42, title: 'Introduction to Computer Science' }] },
            answersCourseRefresh: true,
        });

        expect(await screen.findByTestId('course-entry-42')).toBeInTheDocument();
    });

    it('asks the host for courses every time the picker opens, and keeps the current list rendered meanwhile', async () => {
        const api = createMockVsCodeApi();
        const activeState = {
            exercises: [],
            courses: [{ id: 1, title: 'Existing' }],
            courseId: 1,
            courseTitle: 'Existing',
            currentSessionId: 900,
            conversationTitle: 'BFS loop',
            displayMessageCount: 1,
            contentState: 'content' as const,
        };
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        await screen.findByRole('button', { name: /Existing/ });

        await userEvent.click(screen.getByRole('button', { name: /Existing/ }));

        expect(getPostMessageCalls(api).some(([m]) => (m as { command?: string }).command === 'refreshCourses')).toBe(true);
        // The previous list stays rendered while the answer is in flight:
        // the actual row, not a loading skeleton.
        expect(screen.getByTestId('course-entry-1')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Select course' })).toHaveAttribute('aria-busy', 'false');
    });
});

describe('IrisChatView navigation notice', () => {
    // The host raises the notice AFTER the navigation's snapshot, which is
    // what makes it describe the conversation the student is now looking at.
    const activeState = {
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 8,
        contentState: 'content' as const,
    };

    it('renders whatever notice the host posts', async () => {
        // Deliberately not tied to one wording: the host owns the text, and
        // which events produce one is pinned on the host side. This asserts the
        // channel, which is what the webview is responsible for.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });

        dispatchExtensionMessage({ type: 'showChatNotice', text: 'Started a new conversation.' });

        expect(await screen.findByText('Started a new conversation.')).toBeInTheDocument();
    });

    it('survives a snapshot that navigates nowhere, e.g. the overview refresh that follows', async () => {
        // The same navigation fires `refreshOverview`, whose response emits
        // another snapshot a round trip later. Clearing on every snapshot
        // would make the notice flash and vanish.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage({ type: 'showChatNotice', text: 'Started a new conversation.' });
        await screen.findByText('Started a new conversation.');

        // The message count moves so the assertion below can WAIT for this
        // snapshot to be rendered; asserting straight away would pass even if
        // the snapshot cleared the notice, because the clear had not flushed.
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, displayMessageCount: 9 },
        });
        await screen.findByText(/BFS loop · 9 messages/);

        expect(screen.getByText('Started a new conversation.')).toBeInTheDocument();
    });

    it('is cleared by the next real navigation', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage({ type: 'showChatNotice', text: 'Started a new conversation.' });
        await screen.findByText('Started a new conversation.');

        dispatchExtensionMessage({ type: 'updateIrisState', state: { ...activeState, currentSessionId: 901 } });

        await waitFor(() => expect(screen.queryByText('Started a new conversation.')).toBeNull());
    });
});

describe('IrisChatView transcript keying', () => {
    const activeState = {
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 2,
        contentState: 'content' as const,
    };

    const transcript = (sessionId: number, text: string) => ({
        type: 'loadMessages' as const,
        sessionId,
        messages: [{ id: 1, role: 'assistant' as const, content: text, timestamp: 1 }],
    });

    it('renders the transcript the host posts for the open conversation', async () => {
        // The transcript is keyed on the conversation id: a transcript for a
        // conversation that is no longer open is dropped, and one for the open
        // conversation must land.
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });

        dispatchExtensionMessage(transcript(900, 'because the loop never terminates'));

        expect(await screen.findByText('because the loop never terminates')).toBeInTheDocument();
    });

    it('drops a transcript for a conversation that is no longer open', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage(transcript(900, 'the open one'));
        await screen.findByText('the open one');

        dispatchExtensionMessage(transcript(901, 'a conversation we already left'));

        expect(screen.queryByText('a conversation we already left')).toBeNull();
    });

    it('an assistant frame for the open conversation lands in it', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage(transcript(900, 'first'));
        await screen.findByText('first');

        dispatchExtensionMessage({
            type: 'addMessage',
            sessionId: 900,
            message: { id: 2, role: 'assistant', content: 'and the answer', timestamp: 2 },
        });

        expect(await screen.findByText('and the answer')).toBeInTheDocument();
    });

    it('the send carries the conversation the bubble was drawn in', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage(transcript(900, 'first'));
        await screen.findByText('first');

        await userEvent.type(screen.getByRole('textbox'), 'hello{Enter}');

        const send = getPostMessageCalls(api)
            .map(([m]) => m as { command?: string; payload?: { sessionId?: number } })
            .find(m => m.command === 'sendMessage');
        expect(send?.payload?.sessionId).toBe(900);
    });

    it('holds the server echo of our own send instead of rendering it a second time (issue #380)', async () => {
        // The real path: the server's echo of our own prompt arrives as an
        // addMessage wire frame (irisWebSocketMessageHandler.ts's
        // _renderForeignUserMessage), which IrisChatView routes through
        // applyCommit, not through the store's addMessage.
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage(transcript(900, 'first'));
        await screen.findByText('first');

        await userEvent.type(screen.getByRole('textbox'), 'hello{Enter}');
        await screen.findByText('hello');

        dispatchExtensionMessage({
            type: 'addMessage',
            sessionId: 900,
            message: { id: 91, role: 'user', content: 'hello', timestamp: 2 },
        });

        await waitFor(() => expect(useChatStore.getState().pendingEcho?.message.id).toBe(91));
        expect(screen.getAllByText('hello')).toHaveLength(1);
    });
});

describe('IrisChatView actions that used to read the old model', () => {
    const activeState = {
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 1,
        contentState: 'content' as const,
    };

    async function openWithAnswer(api: ReturnType<typeof createMockVsCodeApi>) {
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });
        dispatchExtensionMessage({
            type: 'loadMessages',
            sessionId: 900,
            messages: [{ id: 5, role: 'assistant' as const, content: 'because', timestamp: 1, final: true }],
        });
        await screen.findByText('because');
    }

    it('feedback resolves the Artemis session from the conversation', async () => {
        // It used to look the id up in the old model's session list, which is
        // empty now: every thumbs click was a silent no-op while the buttons
        // stayed rendered.
        const api = createMockVsCodeApi();
        await openWithAnswer(api);

        await userEvent.click(screen.getByRole('button', { name: 'Helpful' }));

        const feedback = getPostMessageCalls(api)
            .map(([m]) => m as { command?: string; payload?: { sessionId?: number; messageId?: number; feedback?: string } })
            .find(m => m.command === 'messageFeedback');
        expect(feedback?.payload).toEqual({ sessionId: 900, messageId: 5, feedback: 'positive' });
    });

    it('a message that failed with no-context becomes retryable once a conversation is open', async () => {
        const api = createMockVsCodeApi();
        await openWithAnswer(api);
        await userEvent.type(screen.getByRole('textbox'), 'hello{Enter}');
        const localId = getPostMessageCalls(api)
            .map(([m]) => m as { command?: string; payload?: { localId?: string } })
            .find(m => m.command === 'sendMessage')?.payload?.localId as string;

        dispatchExtensionMessage({
            type: 'sendRejected',
            localId,
            sessionId: 900,
            reason: 'no-context',
            errorMessage: 'Please select a course or exercise context first.',
        });

        // The old gate keyed on `store.context`, which nothing sets any more, so
        // Retry was disabled forever.
        expect(await screen.findByRole('button', { name: 'Retry sending this message' })).toBeEnabled();
    });

    it('a genuinely empty dashboard reaches "No courses found" instead of a permanent skeleton', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, courseId: null, currentSessionId: null, courses: [], workspaceExerciseId: null },
        });
        await screen.findByText(/No Artemis workspace detected/);
        expect(getPostMessageCalls(api).some(([m]) => (m as { command?: string }).command === 'refreshCourses')).toBe(true);

        // The host answers with a snapshot that still has no courses, because
        // the student really has none.
        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...activeState, courseId: null, currentSessionId: null, courses: [], workspaceExerciseId: null },
            answersCourseRefresh: true,
        });

        expect(await screen.findByText('No courses found')).toBeInTheDocument();
    });

    it('a snapshot that is not the answer to the refresh does not end the wait', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        const empty = {
            ...activeState, courseId: null, currentSessionId: null, courses: [],
            workspaceExerciseId: null, coursesUnavailable: false,
        };
        dispatchExtensionMessage({ type: 'updateIrisState', state: empty });
        await screen.findByText(/No Artemis workspace detected/);

        // Cold start posts snapshots of its own while the picker's forced
        // fetch is still open. Letting one of those end the wait answers a
        // question nobody has asked yet, and answers it "you have no courses".
        await act(async () => {
            dispatchExtensionMessage({ type: 'updateIrisState', state: empty });
        });
        expect(screen.getByRole('dialog', { name: 'Select course' })).toHaveAttribute('aria-busy', 'true');
        expect(screen.queryByText('No courses found')).toBeNull();

        dispatchExtensionMessage({ type: 'updateIrisState', state: empty, answersCourseRefresh: true });
        expect(await screen.findByText('No courses found')).toBeInTheDocument();
    });

    it('an unreachable server says so instead of claiming the student has no courses', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        const unreachable = {
            ...activeState, courseId: null, currentSessionId: null, courses: [],
            workspaceExerciseId: null, coursesUnavailable: true,
        };
        // Twice, as the empty-dashboard test above: the cold-start view asks
        // for the list on mount, and the answer to THAT request is what ends
        // the loading state. The await between them lets the request go out.
        dispatchExtensionMessage({ type: 'updateIrisState', state: unreachable });
        await screen.findByText(/No Artemis workspace detected/);
        dispatchExtensionMessage({ type: 'updateIrisState', state: unreachable, answersCourseRefresh: true });

        // "No courses found" is a statement about the student's enrolment. The
        // host could not ask, so it must not be made.
        expect(await screen.findByText(/Could not load your courses/)).toBeInTheDocument();
        expect(screen.queryByText('No courses found')).toBeNull();
        // Nor may the line above it hand out an instruction that cannot be
        // followed: there is no course to choose in this state.
        expect(screen.queryByText(/Choose a course to get started/)).toBeNull();
    });

    it('retrying from the unreachable state asks the host again', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        const unreachable = {
            ...activeState, courseId: null, currentSessionId: null, courses: [],
            workspaceExerciseId: null, coursesUnavailable: true,
        };
        dispatchExtensionMessage({ type: 'updateIrisState', state: unreachable });
        await screen.findByText(/No Artemis workspace detected/);
        dispatchExtensionMessage({ type: 'updateIrisState', state: unreachable, answersCourseRefresh: true });
        await screen.findByText(/Could not load your courses/);

        const before = getPostMessageCalls(api)
            .filter(([m]) => (m as { command?: string }).command === 'refreshCourses').length;
        await userEvent.click(screen.getByRole('button', { name: 'Retry loading courses' }));

        const after = getPostMessageCalls(api)
            .filter(([m]) => (m as { command?: string }).command === 'refreshCourses').length;
        expect(after).toBe(before + 1);
    });

    it('courses already on screen survive a failed refresh, and are not replaced by the failure', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        const withCourses = {
            ...activeState, courseId: null, currentSessionId: null,
            courses: [{ id: 7, title: 'Still Pickable' }],
            workspaceExerciseId: null, coursesUnavailable: true,
        };
        dispatchExtensionMessage({ type: 'updateIrisState', state: withCourses });
        await screen.findByText(/No Artemis workspace detected/);
        dispatchExtensionMessage({ type: 'updateIrisState', state: withCourses, answersCourseRefresh: true });

        // The rows stay pickable, but the student is told they were not
        // confirmed: these are exactly the rows that can name a course they
        // were removed from, which is the defect the live catalog exists to
        // remove. Hiding them would be worse; presenting them as current
        // would repeat the bug.
        expect(await screen.findByText('Still Pickable')).toBeInTheDocument();
        expect(screen.getByText(/Could not refresh your courses/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry loading courses' })).toBeEnabled();
    });

    it('a reachable server that answers with no courses keeps the enrolment wording', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        const reachable = {
            ...activeState, courseId: null, currentSessionId: null, courses: [],
            workspaceExerciseId: null, coursesUnavailable: false,
        };
        dispatchExtensionMessage({ type: 'updateIrisState', state: reachable });
        await screen.findByText(/No Artemis workspace detected/);
        dispatchExtensionMessage({ type: 'updateIrisState', state: reachable, answersCourseRefresh: true });

        expect(await screen.findByText('No courses found')).toBeInTheDocument();
        expect(screen.queryByText(/Could not load your courses/)).toBeNull();
        expect(screen.getByText(/Choose a course to get started/)).toBeInTheDocument();
    });
});
