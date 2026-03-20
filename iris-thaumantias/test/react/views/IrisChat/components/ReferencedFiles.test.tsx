import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReferencedFilesData } from '../../../../../src/views/webview/views/IrisChat/types';
import { ReferencedFiles } from '../../../../../src/views/webview/views/IrisChat/components/ReferencedFiles';

function makeFilesData(overrides: Partial<ReferencedFilesData> = {}): ReferencedFilesData {
	return {
		includedFiles: [],
		excludedFiles: [],
		totalCount: 0,
		...overrides,
	};
}

describe('ReferencedFiles', () => {
	it('renders nothing when files is null', () => {
		const { container } = render(<ReferencedFiles files={null} onOpenFile={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});

	it('renders nothing when totalCount is 0', () => {
		const { container } = render(
			<ReferencedFiles files={makeFilesData({ totalCount: 0 })} onOpenFile={vi.fn()} />
		);
		expect(container.firstChild).toBeNull();
	});

	it('renders header button with file count summary', () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java', '/src/Utils.java'],
			totalCount: 2,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);
		expect(screen.getByText('2/2 files referenced')).toBeInTheDocument();
	});

	it('shows correct included/total ratio in header', () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java'],
			excludedFiles: [{ path: '/src/Excluded.java', reason: 'Too large' }],
			totalCount: 2,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);
		expect(screen.getByText('1/2 files referenced')).toBeInTheDocument();
	});

	it('expands to show file list when header clicked', async () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java'],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);

		const headerButton = screen.getByRole('button', { name: /files referenced/i });
		await userEvent.click(headerButton);

		expect(screen.getByText('Main.java')).toBeInTheDocument();
	});

	it('collapses file list when header clicked again', async () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java'],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);

		const headerButton = screen.getByRole('button', { name: /files referenced/i });
		await userEvent.click(headerButton);
		expect(screen.getByText('Main.java')).toBeInTheDocument();

		await userEvent.click(headerButton);
		expect(screen.queryByText('Main.java')).not.toBeInTheDocument();
	});

	it('renders file names (not full paths) for included files', async () => {
		const files = makeFilesData({
			includedFiles: ['/path/to/src/Calculator.java', '/path/to/src/Main.java'],
			totalCount: 2,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);

		await userEvent.click(screen.getByRole('button', { name: /files referenced/i }));

		expect(screen.getByText('Calculator.java')).toBeInTheDocument();
		expect(screen.getByText('Main.java')).toBeInTheDocument();
	});

	it('calls onOpenFile with full path when included file button clicked', async () => {
		const onOpenFile = vi.fn();
		const filePath = '/src/Calculator.java';
		const files = makeFilesData({
			includedFiles: [filePath],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={onOpenFile} />);

		await userEvent.click(screen.getByRole('button', { name: /files referenced/i }));
		await userEvent.click(screen.getByText('Calculator.java'));

		expect(onOpenFile).toHaveBeenCalledWith(filePath);
	});

	it('shows "Will be sent" label for included files', async () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java'],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);

		await userEvent.click(screen.getByRole('button', { name: /files referenced/i }));
		expect(screen.getByText('Will be sent')).toBeInTheDocument();
	});

	it('renders excluded files with reason', async () => {
		const files = makeFilesData({
			includedFiles: [],
			excludedFiles: [{ path: '/src/BigFile.java', reason: 'Too large' }],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);

		await userEvent.click(screen.getByRole('button', { name: /files referenced/i }));

		expect(screen.getByText('BigFile.java')).toBeInTheDocument();
		expect(screen.getByText('Too large')).toBeInTheDocument();
	});

	it('calls onOpenFile with path when excluded file button clicked', async () => {
		const onOpenFile = vi.fn();
		const filePath = '/src/BigFile.java';
		const files = makeFilesData({
			excludedFiles: [{ path: filePath, reason: 'Too large' }],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={onOpenFile} />);

		await userEvent.click(screen.getByRole('button', { name: /files referenced/i }));
		await userEvent.click(screen.getByText('BigFile.java'));

		expect(onOpenFile).toHaveBeenCalledWith(filePath);
	});

	it('header button has aria-expanded attribute', () => {
		const files = makeFilesData({
			includedFiles: ['/src/Main.java'],
			totalCount: 1,
		});
		render(<ReferencedFiles files={files} onOpenFile={vi.fn()} />);
		const headerButton = screen.getByRole('button', { name: /files referenced/i });
		expect(headerButton).toHaveAttribute('aria-expanded');
	});
});
