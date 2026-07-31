import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMockVsCodeApi, dispatchExtensionMessage, getPostMessageCalls } from '@test/react/__helpers__/vscodeApi';
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
const EX7 = { mode: 'PROGRAMMING_EXERCISE_CHAT' as const, entityId: 7, name: 'Sorting' };
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
    conversations: [{ sessionId: 9, courseId: 42, mode: 'PROGRAMMING_EXERCISE_CHAT', entityId: 7, lastActivity: 100 }],
    onSelect: vi.fn(),
    ...over,
});

describe('ContextChip', () => {
    it('shows the chip remove icon while the conversation is empty', () => {
        render(<ContextChip context={EX5} contentState="empty" onRemove={vi.fn()} onOpenPicker={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Remove topic' })).toBeInTheDocument();
    });

    it('hides the chip remove icon once the conversation has content', () => {
        // With content, removing the topic necessarily means leaving for another
        // conversation, and a small remove icon must not silently replace the whole
        // transcript. The picker's "Course chat" entry carries that action instead.
        render(<ContextChip context={EX5} contentState="content" onRemove={vi.fn()} onOpenPicker={vi.fn()} />);
        expect(screen.queryByRole('button', { name: 'Remove topic' })).toBeNull();
    });

    it('renders no chip when the topic is the course', () => {
        const { container } = render(
            <ContextChip context={COURSE42} contentState="empty" onRemove={vi.fn()} onOpenPicker={vi.fn()} />,
        );
        expect(container).toBeEmptyDOMElement();
    });
});

describe('ContextPicker (topic picker)', () => {
    it('warns once that the selection may open another conversation', () => {
        render(<ContextPicker {...pickerProps()} />);
        expect(screen.getByText(/may open a different conversation/)).toBeInTheDocument();
    });

    it('shows no such warning while the conversation is empty', () => {
        // Empty means the pick stages in place, so there is nothing to warn about.
        render(<ContextPicker {...pickerProps({ contentState: 'empty' })} />);
        expect(screen.queryByText(/may open a different conversation/)).toBeNull();
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
            entityName: 'Woche 3',
            lastActivity: 200,
        };
        const history = render(
            <ConversationHistory conversations={[lecture]} currentSessionId={9} onOpen={vi.fn()} nowMs={300} />,
        );
        expect(screen.getByText('Woche 3')).toBeInTheDocument();
        // Unmounted before the second render: both would otherwise live in the
        // same document and the picker assertion below could never fail.
        history.unmount();

        render(<ContextPicker {...pickerProps({ conversations: [lecture] })} />);
        expect(screen.queryByText('Woche 3')).toBeNull();
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

    it('renders no preview line, staged or not', () => {
        // Cut 5. The chip alone carries `pending ?? committed`.
        render(<ChatMessageList
            {...listProps}
            messages={[{ localId: 'a', role: 'user', content: 'hello', timestamp: 1 }]}
            pendingContext={EX7}
            committedContext={COURSE42}
        />);
        expect(screen.queryByTestId('context-preview')).toBeNull();
    });

    it('renders a stored marker row in transcript order, before the message it triggered', () => {
        render(<ChatMessageList
            {...listProps}
            messages={[
                { localId: 'm', role: 'contextSwap', content: 'Topic set to Sorting', timestamp: 1 },
                { localId: 'u', role: 'user', content: 'hello', timestamp: 2 },
            ]}
            pendingContext={undefined}
            committedContext={EX7}
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
});

describe('IrisChatView model switch', () => {
    // EXACTLY what `chatViewStatePresenter._serializeSnapshot` +
    // `_serializeConversation` put on the wire in a logged-in session today:
    // the old model populated, every conversation-first field present but
    // empty, and no `conversationFirst`. This shape shipped before the flag
    // existed and rendered the new, unusable interface; that is what these two
    // tests pin down.
    const hostShapeToday = {
        context: {
            type: 'exercise' as const,
            id: 5,
            title: 'Recursion',
            shortName: 'REC',
            courseId: 42,
            locked: false,
            source: 'workspace-detected' as const,
        },
        activeSessionId: 'local-1',
        sessions: [{
            id: 'local-1',
            artemisSessionId: 900,
            preview: '',
            title: 'BFS loop',
            messageCount: 8,
            createdAt: 1,
            lastActivity: 2,
        }],
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

    it('keeps the old interface while the host only mirrors the conversation-first fields', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: hostShapeToday });

        // The real exercise, not "Choose a course".
        expect(await screen.findByText('Recursion')).toBeInTheDocument();
        expect(screen.queryByText('Choose a course')).toBeNull();

        // And the context picker is still reachable from the header.
        await userEvent.click(screen.getByText('Recursion'));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('switches to the new interface only once the host answers the new commands', async () => {
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
                conversationFirst: true,
            },
        });

        // Asserted on the conversation line first: the course title alone is
        // ambiguous, because the OLD header shows it too (as the exercise's
        // course subtitle), and the store update and the flag land in two
        // commits, so there is one intermediate frame with the old header and
        // the new data.
        expect(await screen.findByText(/BFS loop · 8 messages/)).toBeInTheDocument();
        // Line 1 is a button, and it is the only clickable part of the header.
        expect(screen.getByRole('button', { name: /Introduction to Computer Science/ })).toBeInTheDocument();
    });

    describe('posts only conversation-first commands', () => {
        // Every one of the four paths, not just the topic pick. The host still
        // has live SelectChatContext, CreateNewSession and OpenArtemisSession
        // cases at this commit, so a legacy post beside any new one would be
        // acted on as well the moment the flag arrives ahead of its removal,
        // turning one click into two context selections or two conversations.
        // This invariant has already been reversed twice; the next person to
        // touch it will have none of that context, so all four are pinned.
        const activeState = {
            ...hostShapeToday,
            courseId: 42,
            courseTitle: 'Introduction to Computer Science',
            currentSessionId: 900,
            conversationTitle: 'BFS loop',
            displayMessageCount: 8,
            contentState: 'content' as const,
            conversationFirst: true,
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

                // Wait for the new header before touching anything. The store
                // update and the flag land in separate commits, so the first
                // frame still shows the OLD header, whose controls are
                // different ones: its `+` is disabled at that point and its
                // course row opens the legacy picker, either of which would
                // make these assertions pass or fail for the wrong reason.
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
        context: null,
        activeSessionId: null,
        sessions: [],
        exercises: [],
        courses: [],
        contentState: 'unknown' as const,
        conversationFirst: true,
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

describe('IrisChatView course refresh', () => {
    const coldStartState = {
        context: null,
        activeSessionId: null,
        sessions: [],
        exercises: [],
        courses: [],
        contentState: 'unknown' as const,
        conversationFirst: true,
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

    it('lists the courses once the host answers with a snapshot', async () => {
        const api = createMockVsCodeApi();
        render(<IrisChatView vscodeApi={api} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: coldStartState });
        await screen.findByText(/No Artemis workspace detected/);

        dispatchExtensionMessage({
            type: 'updateIrisState',
            state: { ...coldStartState, courses: [{ id: 42, title: 'Introduction to Computer Science' }] },
        });

        expect(await screen.findByTestId('course-entry-42')).toBeInTheDocument();
    });
});

describe('IrisChatView navigation notice', () => {
    // The host raises the notice AFTER the navigation's snapshot, which is
    // what makes it describe the conversation the student is now looking at.
    const activeState = {
        context: null,
        activeSessionId: null,
        sessions: [],
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 8,
        contentState: 'content' as const,
        conversationFirst: true,
    };

    it('renders the notice the host posts after a topic pick opened another conversation', async () => {
        render(<IrisChatView vscodeApi={createMockVsCodeApi()} />);
        dispatchExtensionMessage({ type: 'updateIrisState', state: activeState });

        dispatchExtensionMessage({ type: 'showChatNotice', text: 'Switched to a different conversation.' });

        expect(await screen.findByText('Switched to a different conversation.')).toBeInTheDocument();
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
