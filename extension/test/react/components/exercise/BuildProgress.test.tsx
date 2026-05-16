import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BuildProgress } from '@webview/components/exercise/BuildProgress';

describe('BuildProgress', () => {
	it('renders nothing when status is idle', () => {
		const { container } = render(<BuildProgress status="idle" />);
		expect(container.firstChild).toBeNull();
	});

	it('renders "Build in Progress" title when building', () => {
		render(<BuildProgress status="building" />);
		expect(screen.getByText('Build in Progress')).toBeInTheDocument();
	});

	it('shows default building message', () => {
		render(<BuildProgress status="building" />);
		expect(screen.getByText(/Building your submission/)).toBeInTheDocument();
	});

	it('shows custom message when provided', () => {
		render(<BuildProgress status="building" message="Compiling your code..." />);
		expect(screen.getByText('Compiling your code...')).toBeInTheDocument();
	});

	it('shows queued message when status is queued', () => {
		render(<BuildProgress status="queued" />);
		expect(screen.getByText(/Build queued/)).toBeInTheDocument();
	});

	it('renders progress bar element', () => {
		const { container } = render(<BuildProgress status="building" />);
		// Progress bar container div is present
		const buildStatus = container.querySelector('[class*="buildStatus"]');
		expect(buildStatus).toBeInTheDocument();
	});

	it('shows log entries when provided', () => {
		const logs = [
			{ level: 'info' as const, message: 'Compilation started' },
			{ level: 'error' as const, message: 'Build failed: syntax error' },
		];
		render(<BuildProgress status="building" logEntries={logs} />);

		expect(screen.getByText('Compilation started')).toBeInTheDocument();
		expect(screen.getByText('Build failed: syntax error')).toBeInTheDocument();
	});

	it('shows "Build Logs" title when log entries exist', () => {
		const logs = [{ level: 'info' as const, message: 'Log entry' }];
		render(<BuildProgress status="building" logEntries={logs} />);
		expect(screen.getByText('Build Logs')).toBeInTheDocument();
	});

	it('does not show Build Logs section when no entries', () => {
		render(<BuildProgress status="building" logEntries={[]} />);
		expect(screen.queryByText('Build Logs')).not.toBeInTheDocument();
	});

	it('shows log entry level labels', () => {
		const logs = [
			{ level: 'warning' as const, message: 'Warning message' },
		];
		render(<BuildProgress status="building" logEntries={logs} />);
		expect(screen.getByText('[WARNING]')).toBeInTheDocument();
	});

	it('shows timestamp when provided in log entry', () => {
		const logs = [
			{ level: 'info' as const, message: 'Done', timestamp: '12:34:56' },
		];
		render(<BuildProgress status="building" logEntries={logs} />);
		expect(screen.getByText('12:34:56')).toBeInTheDocument();
	});
});
