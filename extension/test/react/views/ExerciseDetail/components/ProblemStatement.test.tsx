import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemStatement } from '../../../../../src/webview/views/ExerciseDetail/components/ProblemStatement';

describe('ProblemStatement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the problem statement container', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Simple problem</p>" />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('shows skeleton loading state when serverRenderedHtml is not provided', () => {
		const { container } = render(<ProblemStatement />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
		// Skeleton elements should be present (aria-busy="true")
		const skeletons = container.querySelectorAll('[aria-busy="true"]');
		expect(skeletons.length).toBeGreaterThan(0);
	});

	it('shows error message after SSR timeout', () => {
		vi.useFakeTimers();
		render(<ProblemStatement />);
		expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
		act(() => { vi.advanceTimersByTime(10_000); });
		expect(screen.getByText(/Failed to load the exercise description/)).toBeInTheDocument();
		vi.useRealTimers();
	});

	it('clears timeout when serverRenderedHtml arrives', () => {
		vi.useFakeTimers();
		const { rerender } = render(<ProblemStatement />);
		act(() => { vi.advanceTimersByTime(5_000); });
		rerender(<ProblemStatement serverRenderedHtml="<p>Loaded</p>" />);
		act(() => { vi.advanceTimersByTime(10_000); });
		expect(screen.getByText('Loaded')).toBeInTheDocument();
		expect(screen.queryByText(/Failed to load/)).not.toBeInTheDocument();
		vi.useRealTimers();
	});

	it('renders server-rendered HTML content', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Implement a sorting algorithm</p>" />);
		expect(screen.getByText('Implement a sorting algorithm')).toBeInTheDocument();
	});

	it('renders HTML heading elements', () => {
		render(<ProblemStatement serverRenderedHtml="<h2>Task Description</h2><p>Some text</p>" />);
		expect(screen.getByText('Task Description')).toBeInTheDocument();
	});

	it('renders download links when provided', () => {
		const downloadLinks = [
			{ name: 'Assignment.pdf', url: 'https://example.com/file.pdf' },
			{ name: 'Starter.zip', url: 'https://example.com/starter.zip' },
		];
		render(<ProblemStatement serverRenderedHtml="<p>Problem</p>" downloadLinks={downloadLinks} />);
		expect(screen.getByText('Assignment.pdf')).toBeInTheDocument();
		expect(screen.getByText('Starter.zip')).toBeInTheDocument();
	});

	it('shows Downloads header when download links are present', () => {
		const downloadLinks = [{ name: 'File.pdf', url: 'https://example.com/file.pdf' }];
		render(<ProblemStatement serverRenderedHtml="<p>Problem</p>" downloadLinks={downloadLinks} />);
		expect(screen.getByText('Downloads')).toBeInTheDocument();
	});

	it('does not show Downloads section when no download links', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Problem</p>" downloadLinks={[]} />);
		expect(screen.queryByText('Downloads')).not.toBeInTheDocument();
	});

	it('calls onDownload with url and name when download button is clicked', async () => {
		const onDownload = vi.fn();
		const downloadLinks = [
			{ name: 'Assignment.pdf', url: 'https://example.com/file.pdf' },
		];
		render(
			<ProblemStatement
				serverRenderedHtml="<p>Problem</p>"
				downloadLinks={downloadLinks}
				onDownload={onDownload}
			/>
		);
		await userEvent.click(screen.getByText('Assignment.pdf'));
		expect(onDownload).toHaveBeenCalledWith('https://example.com/file.pdf', 'Assignment.pdf');
	});

	it('renders without optional props without crashing', () => {
		render(<ProblemStatement serverRenderedHtml="<p>Problem</p>" />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('renders code block elements in HTML content', () => {
		const html = '<pre><code>public class Solution { }</code></pre>';
		render(<ProblemStatement serverRenderedHtml={html} />);
		expect(screen.getByText('public class Solution { }')).toBeInTheDocument();
	});

	it('renders link elements with href in HTML content', () => {
		const html = '<a href="https://example.com">Example Link</a>';
		render(<ProblemStatement serverRenderedHtml={html} />);
		const link = screen.getByText('Example Link');
		expect(link).toBeInTheDocument();
	});

	it('renders image elements in HTML content', () => {
		const html = '<img src="https://example.com/image.png" alt="diagram" />';
		render(<ProblemStatement serverRenderedHtml={html} />);
		const img = screen.getByAltText('diagram');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'https://example.com/image.png');
	});
});
