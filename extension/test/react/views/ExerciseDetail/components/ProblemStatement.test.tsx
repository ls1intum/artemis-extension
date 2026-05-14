import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ProblemStatement } from '../../../../../src/webview/views/ExerciseDetail/components/ProblemStatement';

describe('ProblemStatement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('renders the problem statement container', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Simple problem</p>" />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('shows skeleton loading state when serverRenderedHtml is not provided', () => {
		const { container } = render(<ProblemStatement />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
		const skeletons = container.querySelectorAll('[aria-busy="true"]');
		expect(skeletons.length).toBeGreaterThan(0);
	});

	it('shows error message after SSR timeout', () => {
		vi.useFakeTimers();
		render(<ProblemStatement />);
		expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
		act(() => { vi.advanceTimersByTime(10_000); });
		expect(screen.getByText(/Failed to load the exercise description/)).toBeInTheDocument();
	});

	it('clears timeout when serverRenderedHtml arrives', () => {
		vi.useFakeTimers();
		const { rerender } = render(<ProblemStatement />);
		act(() => { vi.advanceTimersByTime(5_000); });
		rerender(<ProblemStatement serverRenderedHtml="<p>Loaded</p>" />);
		act(() => { vi.advanceTimersByTime(10_000); });
		expect(screen.getByText('Loaded')).toBeInTheDocument();
		expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
	});

	it('renders server-rendered HTML content', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Implement a sorting algorithm</p>" />);
		expect(screen.getByText('Implement a sorting algorithm')).toBeInTheDocument();
	});

	it('renders HTML heading elements', () => {
		render(<ProblemStatement serverRenderedHtml="<h2>Task Description</h2><p>Some text</p>" />);
		expect(screen.getByText('Task Description')).toBeInTheDocument();
	});

	it('renders code block elements in HTML content', () => {
		const html = '<pre><code>public class Solution { }</code></pre>';
		render(<ProblemStatement serverRenderedHtml={html} />);
		expect(screen.getByText('public class Solution { }')).toBeInTheDocument();
	});

	it('renders link elements with their href attribute', () => {
		const html = '<a href="https://example.com">Example Link</a>';
		render(<ProblemStatement serverRenderedHtml={html} />);
		const link = screen.getByRole('link', { name: 'Example Link' });
		expect(link).toHaveAttribute('href', 'https://example.com');
	});

	it('renders image elements in HTML content', () => {
		const html = '<img src="https://example.com/image.png" alt="diagram" />';
		render(<ProblemStatement serverRenderedHtml={html} />);
		const img = screen.getByAltText('diagram');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'https://example.com/image.png');
	});

	it('strips server-injected KaTeX <script> and <link> tags before rendering', () => {
		const html = `
			<body>
				<script src="https://cdn/katex.min.js"></script>
				<link rel="stylesheet" href="https://cdn/katex.min.css">
				<p>Body content</p>
			</body>`;
		const { container } = render(<ProblemStatement serverRenderedHtml={html} />);
		expect(screen.getByText('Body content')).toBeInTheDocument();
		expect(container.querySelectorAll('script')).toHaveLength(0);
		expect(container.querySelectorAll('link[href*="katex"]')).toHaveLength(0);
	});
});
