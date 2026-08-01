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
        exercises: [],
        courses: [{ id: 42, title: 'Introduction to Computer Science' }],
        courseId: 42,
        courseTitle: 'Introduction to Computer Science',
        currentSessionId: 900,
        conversationTitle: 'BFS loop',
        displayMessageCount: 8,
        contentState: 'content' as const,
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
        });

        expect(await screen.findByText('No courses found')).toBeInTheDocument();
    });
});
