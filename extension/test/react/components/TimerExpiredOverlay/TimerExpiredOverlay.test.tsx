import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TimerExpiredOverlay } from '@webview/components/TimerExpiredOverlay/TimerExpiredOverlay';

describe('TimerExpiredOverlay', () => {
	it('renders the expired message when visible', () => {
		render(<TimerExpiredOverlay visible={true} onDismiss={vi.fn()} />);
		expect(screen.getByText("Time's Up")).toBeInTheDocument();
	});

	it('renders explanatory message about no further submissions', () => {
		render(<TimerExpiredOverlay visible={true} onDismiss={vi.fn()} />);
		expect(screen.getByText(/no further submissions are allowed/i)).toBeInTheDocument();
	});

	it('renders a Close button', () => {
		render(<TimerExpiredOverlay visible={true} onDismiss={vi.fn()} />);
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
	});

	it('calls onDismiss when Close button is clicked', async () => {
		const handleDismiss = vi.fn();
		render(<TimerExpiredOverlay visible={true} onDismiss={handleDismiss} />);

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(handleDismiss).toHaveBeenCalledOnce();
	});

	it('renders nothing when visible=false', () => {
		const { container } = render(<TimerExpiredOverlay visible={false} onDismiss={vi.fn()} />);
		expect(container.firstChild).toBeNull();
	});
});
