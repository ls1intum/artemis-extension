import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ReconnectBanner } from '../../../../src/views/webview/react/components/ReconnectBanner/ReconnectBanner';

function dispatchWindowMessage(type: string) {
	const event = new MessageEvent('message', { data: { type } });
	window.dispatchEvent(event);
}

describe('ReconnectBanner', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.runOnlyPendingTimers();
		vi.useRealTimers();
	});

	it('does not show banner initially', () => {
		render(<ReconnectBanner />);
		expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
	});

	it('shows banner when websocketDisconnected message received', () => {
		render(<ReconnectBanner />);

		act(() => {
			dispatchWindowMessage('websocketDisconnected');
		});

		expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
	});

	it('hides banner after 2 seconds when websocketConnected message received', () => {
		render(<ReconnectBanner />);

		act(() => {
			dispatchWindowMessage('websocketDisconnected');
		});
		expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();

		act(() => {
			dispatchWindowMessage('websocketConnected');
		});
		// Banner is still visible (will hide after 2s timeout)
		expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();

		act(() => {
			vi.advanceTimersByTime(2000);
		});

		expect(screen.queryByText(/Reconnecting to Artemis/)).not.toBeInTheDocument();
	});

	it('shows banner again if disconnected after reconnecting', () => {
		render(<ReconnectBanner />);

		act(() => {
			dispatchWindowMessage('websocketDisconnected');
		});
		act(() => {
			dispatchWindowMessage('websocketConnected');
			vi.advanceTimersByTime(2000);
		});
		expect(screen.queryByText(/Reconnecting to Artemis/)).not.toBeInTheDocument();

		act(() => {
			dispatchWindowMessage('websocketDisconnected');
		});
		expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
	});

	it('ignores messages with unknown commands', () => {
		render(<ReconnectBanner />);

		act(() => {
			dispatchWindowMessage('someOtherCommand');
		});

		expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
	});

	it('does not show banner before 2 seconds elapses after reconnect', () => {
		render(<ReconnectBanner />);

		act(() => {
			dispatchWindowMessage('websocketDisconnected');
		});
		act(() => {
			dispatchWindowMessage('websocketConnected');
		});

		// Advance only 1 second — banner should still be visible
		act(() => {
			vi.advanceTimersByTime(1000);
		});

		expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
	});

	it('removes event listener on unmount (no memory leak)', () => {
		const addListenerSpy = vi.spyOn(window, 'addEventListener');
		const removeListenerSpy = vi.spyOn(window, 'removeEventListener');

		const { unmount } = render(<ReconnectBanner />);
		unmount();

		expect(removeListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
	});
});
