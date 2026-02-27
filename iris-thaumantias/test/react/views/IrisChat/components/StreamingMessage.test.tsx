import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock streamdown since it's an ESM package
vi.mock('streamdown', () => ({
	Streamdown: ({
		children,
		mode,
		parseIncompleteMarkdown,
	}: {
		children?: string;
		mode?: string;
		parseIncompleteMarkdown?: boolean;
	}) => (
		<div
			data-testid="streamdown"
			data-mode={mode}
			data-parse-incomplete={String(parseIncompleteMarkdown ?? false)}
		>
			{children}
		</div>
	),
}));

// Mock CodeBlock to avoid Shiki in these tests
vi.mock(
	'../../../../../src/views/webview/react/views/IrisChat/components/CodeBlock',
	() => ({
		CodeBlock: ({ language, children }: { language?: string; children?: string }) => (
			<pre data-testid="code-block" data-language={language}><code>{children}</code></pre>
		),
	})
);

import { StreamingMessage } from '../../../../../src/views/webview/react/views/IrisChat/components/StreamingMessage';

describe('StreamingMessage', () => {
	it('renders without crashing', () => {
		expect(() => render(<StreamingMessage chunks={[]} />)).not.toThrow();
	});

	it('renders Streamdown in streaming mode', () => {
		render(<StreamingMessage chunks={['Hello']} />);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown).toHaveAttribute('data-mode', 'streaming');
	});

	it('renders Streamdown with parseIncompleteMarkdown enabled', () => {
		render(<StreamingMessage chunks={['# Heading']} />);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown).toHaveAttribute('data-parse-incomplete', 'true');
	});

	it('joins multiple chunks into a single content string', () => {
		render(<StreamingMessage chunks={['Hello', ' ', 'world']} />);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown).toHaveTextContent('Hello world');
	});

	it('renders empty content for empty chunks array', () => {
		render(<StreamingMessage chunks={[]} />);
		const streamdown = screen.getByTestId('streamdown');
		expect(streamdown.textContent).toBe('');
	});

	it('updates content when chunks prop changes', () => {
		const { rerender } = render(<StreamingMessage chunks={['Hello']} />);
		expect(screen.getByTestId('streamdown')).toHaveTextContent('Hello');

		rerender(<StreamingMessage chunks={['Hello', ' world']} />);
		expect(screen.getByTestId('streamdown')).toHaveTextContent('Hello world');
	});

	it('renders single chunk correctly', () => {
		render(<StreamingMessage chunks={['Single chunk content']} />);
		expect(screen.getByTestId('streamdown')).toHaveTextContent('Single chunk content');
	});

	it('handles rapid chunk accumulation (many small tokens)', () => {
		const manyChunks = Array.from({ length: 50 }, (_, i) => `token${i} `);
		render(<StreamingMessage chunks={manyChunks} />);

		const expected = manyChunks.join('');
		expect(screen.getByTestId('streamdown')).toHaveTextContent(expected.trim());
	});

	it('renders partial markdown content during streaming', () => {
		// Simulate partial markdown - heading without closing
		render(<StreamingMessage chunks={['## Partial head']} />);
		expect(screen.getByTestId('streamdown')).toHaveTextContent('## Partial head');
	});

	it('renders the streaming message container div', () => {
		const { container } = render(<StreamingMessage chunks={['content']} />);
		// The component wraps Streamdown in a div.streamingMessage
		expect(container.firstChild).toBeInTheDocument();
	});
});
