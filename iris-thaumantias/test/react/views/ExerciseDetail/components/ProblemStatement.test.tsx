import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProblemStatement } from '../../../../../src/webview/views/ExerciseDetail/components/ProblemStatement';
import { createMockVsCodeApi } from '../../../__helpers__/vscodeApi';

// Mock DOMPurify so sanitization is a passthrough for simpler assertion
vi.mock('dompurify', () => ({
	default: {
		sanitize: (html: string) => html,
		addHook: vi.fn(),
		removeAllHooks: vi.fn(),
	},
}));

// Mock processProblemStatement to return the markdown as-is for simple test cases
vi.mock('../../../../../src/webview/utils/problemStatementProcessor', () => ({
	processProblemStatement: (markdown: string) => markdown,
}));

describe('ProblemStatement', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('renders the problem statement container', () => {
		render(<ProblemStatement markdown="<p>Simple problem</p>" />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('renders HTML content from the markdown prop', () => {
		render(<ProblemStatement markdown="<p>Implement a sorting algorithm</p>" />);
		expect(screen.getByText('Implement a sorting algorithm')).toBeInTheDocument();
	});

	it('renders HTML heading elements', () => {
		render(<ProblemStatement markdown="<h2>Task Description</h2><p>Some text</p>" />);
		expect(screen.getByText('Task Description')).toBeInTheDocument();
	});

	it('renders empty problem statement without crash', () => {
		render(<ProblemStatement markdown="" />);
		// Should render container without crashing
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('renders download links when provided', () => {
		const downloadLinks = [
			{ name: 'Assignment.pdf', url: 'https://example.com/file.pdf' },
			{ name: 'Starter.zip', url: 'https://example.com/starter.zip' },
		];
		render(<ProblemStatement markdown="<p>Problem</p>" downloadLinks={downloadLinks} />);
		expect(screen.getByText('Assignment.pdf')).toBeInTheDocument();
		expect(screen.getByText('Starter.zip')).toBeInTheDocument();
	});

	it('shows Downloads header when download links are present', () => {
		const downloadLinks = [{ name: 'File.pdf', url: 'https://example.com/file.pdf' }];
		render(<ProblemStatement markdown="<p>Problem</p>" downloadLinks={downloadLinks} />);
		expect(screen.getByText('Downloads')).toBeInTheDocument();
	});

	it('does not show Downloads section when no download links', () => {
		render(<ProblemStatement markdown="<p>Problem</p>" downloadLinks={[]} />);
		expect(screen.queryByText('Downloads')).not.toBeInTheDocument();
	});

	it('calls onDownload with url and name when download button is clicked', async () => {
		const onDownload = vi.fn();
		const downloadLinks = [
			{ name: 'Assignment.pdf', url: 'https://example.com/file.pdf' },
		];
		render(
			<ProblemStatement
				markdown="<p>Problem</p>"
				downloadLinks={downloadLinks}
				onDownload={onDownload}
			/>
		);
		await userEvent.click(screen.getByText('Assignment.pdf'));
		expect(onDownload).toHaveBeenCalledWith('https://example.com/file.pdf', 'Assignment.pdf');
	});

	it('renders without optional props without crashing', () => {
		render(<ProblemStatement markdown="<p>Problem</p>" />);
		expect(screen.getByText('Exercise Description')).toBeInTheDocument();
	});

	it('renders code block elements in HTML content', () => {
		const html = '<pre><code>public class Solution { }</code></pre>';
		render(<ProblemStatement markdown={html} />);
		expect(screen.getByText('public class Solution { }')).toBeInTheDocument();
	});

	it('renders link elements with href in HTML content', () => {
		const html = '<a href="https://example.com">Example Link</a>';
		render(<ProblemStatement markdown={html} />);
		const link = screen.getByText('Example Link');
		expect(link).toBeInTheDocument();
	});

	it('renders image elements in HTML content', () => {
		const html = '<img src="https://example.com/image.png" alt="diagram" />';
		render(<ProblemStatement markdown={html} />);
		const img = screen.getByAltText('diagram');
		expect(img).toBeInTheDocument();
		expect(img).toHaveAttribute('src', 'https://example.com/image.png');
	});
});
