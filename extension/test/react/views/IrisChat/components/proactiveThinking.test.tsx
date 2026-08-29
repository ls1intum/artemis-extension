import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { IrisActivityDTO, IrisRunState } from '@shared/types/apiResponses';

import type { StreamingState } from '@webview/views/IrisChat/types';

vi.mock('use-stick-to-bottom', () => ({
	useStickToBottom: vi.fn().mockReturnValue({
		scrollRef: { current: null },
		contentRef: { current: null },
		isAtBottom: true,
		scrollToBottom: vi.fn(),
	}),
}));

vi.mock('streamdown', () => ({
	Streamdown: ({ children }: { children?: string }) => <div data-testid="streamdown">{children}</div>,
}));

vi.mock('@webview/views/IrisChat/components/CodeBlock', () => ({
	CodeBlock: ({ children }: { children?: string }) => <pre><code>{children}</code></pre>,
}));

import { ChatMessageList } from '@webview/views/IrisChat/components/ChatMessageList';

const IDLE: StreamingState = { isStreaming: false };

interface Overrides {
	streaming?: StreamingState;
	proactiveThinking?: boolean;
	activities?: IrisActivityDTO[];
	liveDraft?: { runId: string; text: string } | null;
	runState?: IrisRunState | null;
	runError?: { message?: string } | null;
}

function renderList(o: Overrides = {}) {
	return render(
		<ChatMessageList
			messages={[]}
			streaming={o.streaming ?? IDLE}
			proactiveThinking={o.proactiveThinking}
			activities={o.activities ?? []}
			liveDraft={o.liveDraft ?? null}
			runState={o.runState ?? null}
			runError={o.runError ?? null}
			onFeedback={vi.fn()}
			onSendPrompt={vi.fn()}
			hasContext
		/>
	);
}

/**
 * The proactive "preparing your hint" bit is independent of the normal run's `streaming` flag, and
 * the two must not be able to hide each other. A dead run's error in particular used to swallow the
 * spinner, because ThinkingIndicator renders `FAILED` before it looks at `isVisible`.
 */
describe('proactive thinking indicator', () => {
	it('shows from the proactive bit alone, with no run in sight', () => {
		renderList({ proactiveThinking: true });
		expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
	});

	it('still shows from the normal run alone', () => {
		renderList({ streaming: { isStreaming: true } });
		expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
	});

	it('shows exactly one indicator when both are true', () => {
		renderList({ streaming: { isStreaming: true }, proactiveThinking: true });
		expect(screen.getAllByTestId('thinking-indicator')).toHaveLength(1);
	});

	it('shows nothing when both are off', () => {
		renderList();
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
	});

	it('a live run keeps the surface: its activities suppress the proactive spinner', () => {
		renderList({
			proactiveThinking: true,
			activities: [{ id: 'a1', kind: 'TOOL', name: 'file_lookup', state: 'RUNNING' } as unknown as IrisActivityDTO],
		});
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
	});

	it('a live draft suppresses it too', () => {
		renderList({ proactiveThinking: true, liveDraft: { runId: 'r1', text: 'partial' } });
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
	});

	it('a dead run error and the proactive spinner are both shown, whichever came first', () => {
		renderList({ proactiveThinking: true, runState: 'FAILED', runError: { message: 'Run failed' } });
		expect(screen.getByRole('alert')).toHaveTextContent('Run failed');
		expect(screen.getByTestId('thinking-indicator')).toBeInTheDocument();
	});

	it('without the proactive bit a FAILED run renders exactly what it always did', () => {
		renderList({ streaming: { isStreaming: true }, runState: 'FAILED', runError: { message: 'Run failed' } });
		expect(screen.getByRole('alert')).toHaveTextContent('Run failed');
		expect(screen.queryByTestId('thinking-indicator')).toBeNull();
	});
});
