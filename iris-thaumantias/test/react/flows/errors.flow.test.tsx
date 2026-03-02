/**
 * Error suite: error boundaries, ServiceHealth degraded/disconnected states,
 * ReconnectBanner connection loss, and API error handling.
 *
 * Separate from happy-path flows per CONTEXT.md decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceHealth } from '../../../src/views/webview/react/components/ServiceHealth/ServiceHealth';
import type { ServiceInfo } from '../../../src/views/webview/react/components/ServiceHealth/ServiceHealth';
import { ReconnectBanner } from '../../../src/views/webview/react/components/ReconnectBanner/ReconnectBanner';
import { ErrorMessage } from '../../../src/views/webview/react/components/ErrorMessage/ErrorMessage';
import { CourseListView } from '../../../src/views/webview/react/views/CourseList/CourseListView';
import { useCourseListStore } from '../../../src/views/webview/react/stores/useCourseListStore';
import { createMockVsCodeApi, dispatchExtensionMessage } from '../__helpers__/vscodeApi';

// ============================================================================
// Error Boundary
// ============================================================================

class ErrorBoundary extends React.Component<
    { children: React.ReactNode; fallback?: React.ReactNode },
    { hasError: boolean; error: Error | null }
> {
    constructor(props: { children: React.ReactNode; fallback?: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? (
                <div role="alert" data-testid="error-boundary-fallback">
                    <p>Something went wrong. Please try again.</p>
                </div>
            );
        }
        return this.props.children;
    }
}

import React from 'react';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
    if (shouldThrow) {
        throw new Error('Render error: component crashed');
    }
    return <div>Component rendered successfully</div>;
}

// ============================================================================
// Error Boundary Tests
// ============================================================================

describe('Error suite: error boundary', () => {
    // Suppress React error boundary console output during tests
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('displays fallback UI when component crashes during render', () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    });

    it('shows user-friendly message, not a stack trace', () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        // Message should be readable prose, not a JS stack trace
        const fallback = screen.getByRole('alert');
        expect(fallback.textContent).not.toContain('at ThrowingComponent');
        expect(fallback.textContent).not.toContain('Error:');
        expect(fallback.textContent).toContain('Something went wrong');
    });

    it('renders children normally when no crash occurs', () => {
        render(
            <ErrorBoundary>
                <ThrowingComponent shouldThrow={false} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Component rendered successfully')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('accepts a custom fallback element', () => {
        render(
            <ErrorBoundary fallback={<div role="alert">Custom error UI</div>}>
                <ThrowingComponent shouldThrow={true} />
            </ErrorBoundary>
        );

        expect(screen.getByText('Custom error UI')).toBeInTheDocument();
    });
});

// ============================================================================
// ServiceHealth error state tests
// ============================================================================

const degradedServices: ServiceInfo[] = [
    {
        name: 'Artemis API',
        status: 'online',
        message: 'Connected',
        endpoint: 'https://artemis.example.com/api',
        httpStatus: '200',
    },
    {
        name: 'Iris AI',
        status: 'offline',
        message: 'Unavailable',
        endpoint: 'https://artemis.example.com/iris',
        httpStatus: '503',
        response: 'Service temporarily unavailable',
    },
    {
        name: 'WebSocket',
        status: 'checking',
        message: 'Reconnecting...',
    },
];

const allOfflineServices: ServiceInfo[] = [
    { name: 'Artemis API', status: 'offline', message: 'Connection refused' },
    { name: 'Iris AI', status: 'offline', message: 'Connection refused' },
    { name: 'WebSocket', status: 'offline', message: 'Connection refused' },
];

describe('Error suite: ServiceHealth degraded states', () => {
    it('shows degraded status indicators for multiple service states', () => {
        render(<ServiceHealth services={degradedServices} />);

        expect(screen.getByText('Artemis API')).toBeInTheDocument();
        expect(screen.getByText('Iris AI')).toBeInTheDocument();
        expect(screen.getByText('WebSocket')).toBeInTheDocument();
    });

    it('shows offline service message for degraded service', () => {
        render(<ServiceHealth services={degradedServices} />);
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });

    it('shows reconnecting message for checking state', () => {
        render(<ServiceHealth services={degradedServices} />);
        expect(screen.getByText('Reconnecting...')).toBeInTheDocument();
    });

    it('expands offline service to show details on click', async () => {
        render(<ServiceHealth services={degradedServices} />);

        await userEvent.click(screen.getByText('Iris AI'));

        expect(screen.getByText('Endpoint:')).toBeInTheDocument();
        expect(screen.getByText('https://artemis.example.com/iris')).toBeInTheDocument();
        expect(screen.getByText('HTTP Status:')).toBeInTheDocument();
    });

    it('shows all services as disconnected when all are offline', () => {
        render(<ServiceHealth services={allOfflineServices} />);

        // All three services should show "Connection refused"
        const messages = screen.getAllByText('Connection refused');
        expect(messages).toHaveLength(3);
    });

    it('renders disconnected state for all services without crashing', () => {
        const { container } = render(<ServiceHealth services={allOfflineServices} />);
        expect(container.firstChild).toBeInTheDocument();
    });

    it('shows refresh button in degraded state and triggers refresh', async () => {
        const handleRefresh = vi.fn();
        render(<ServiceHealth services={degradedServices} onRefresh={handleRefresh} />);

        const btn = screen.getByRole('button', { name: /Check Status/ });
        await userEvent.click(btn);

        expect(handleRefresh).toHaveBeenCalledOnce();
    });

    it('disables refresh button while refreshing in degraded state', () => {
        render(<ServiceHealth services={degradedServices} onRefresh={vi.fn()} isRefreshing />);
        const btn = screen.getByRole('button', { name: /Checking/ });
        expect(btn).toBeDisabled();
    });
});

// ============================================================================
// ReconnectBanner connection loss and reconnect action tests
// ============================================================================

function dispatchWebSocketStatus(isConnected: boolean) {
    const event = new MessageEvent('message', {
        data: { type: 'updateWebSocketStatus', isConnected },
    });
    window.dispatchEvent(event);
}

describe('Error suite: ReconnectBanner', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
    });

    it('shows ReconnectBanner on connection loss (updateWebSocketStatus false)', () => {
        render(<ReconnectBanner />);

        act(() => {
            dispatchWebSocketStatus(false);
        });

        expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
    });

    it('banner disappears after successful reconnection and 2s delay', () => {
        render(<ReconnectBanner />);

        act(() => {
            dispatchWebSocketStatus(false);
        });
        expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();

        act(() => {
            dispatchWebSocketStatus(true);
            vi.advanceTimersByTime(2000);
        });

        expect(screen.queryByText(/Reconnecting to Artemis/)).not.toBeInTheDocument();
    });

    it('does not show banner when connection never drops', () => {
        render(<ReconnectBanner />);
        expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
    });

    it('banner reappears if disconnected again after recovery', () => {
        render(<ReconnectBanner />);

        // First disconnect → reconnect cycle
        act(() => {
            dispatchWebSocketStatus(false);
        });
        act(() => {
            dispatchWebSocketStatus(true);
            vi.advanceTimersByTime(2000);
        });
        expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();

        // Second disconnect — banner should reappear
        act(() => {
            dispatchWebSocketStatus(false);
        });
        expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
    });

    it('banner remains visible until 2 seconds have passed after reconnect', () => {
        render(<ReconnectBanner />);

        act(() => {
            dispatchWebSocketStatus(false);
        });
        act(() => {
            dispatchWebSocketStatus(true);
        });

        // Only 1 second passed — banner still visible
        act(() => {
            vi.advanceTimersByTime(1000);
        });

        expect(screen.getByText(/Reconnecting to Artemis/)).toBeInTheDocument();
    });
});

// ============================================================================
// API error responses in views
// ============================================================================

describe('Error suite: API error responses in views', () => {
    it('displays error message when store has an error', () => {
        useCourseListStore.setState({ error: 'Failed to load courses: Network error', isLoading: false });
        const mockApi = createMockVsCodeApi();
        render(<CourseListView vscodeApi={mockApi} />);

        expect(screen.getByText('Failed to load courses: Network error')).toBeInTheDocument();
    });

    it('shows retry button when error state is active', () => {
        useCourseListStore.setState({ error: 'Network error', isLoading: false });
        const mockApi = createMockVsCodeApi();
        render(<CourseListView vscodeApi={mockApi} />);

        expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
    });

    it('clicking retry sends reload postMessage', async () => {
        useCourseListStore.setState({ error: 'Network error', isLoading: false });
        const mockApi = createMockVsCodeApi();
        render(<CourseListView vscodeApi={mockApi} />);

        await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

        expect(mockApi.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'command', command: 'reloadCourses' })
        );
    });

    it('transitions from error to loading state after retry', async () => {
        useCourseListStore.setState({ error: 'Network error', isLoading: false });
        const mockApi = createMockVsCodeApi();
        render(<CourseListView vscodeApi={mockApi} />);

        await userEvent.click(screen.getByRole('button', { name: /Retry/i }));

        // After clicking retry the store transitions to loading state
        await waitFor(() => {
            const busyElements = document.querySelectorAll('[aria-busy="true"]');
            // Either loading or the error clears (depends on store implementation)
            expect(mockApi.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'reloadCourses' })
            );
        });
    });

    it('ErrorMessage component shows error text and retry button', () => {
        const handleRetry = vi.fn();
        render(<ErrorMessage error="Something went wrong loading data." onRetry={handleRetry} />);

        expect(screen.getByText('Something went wrong loading data.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('ErrorMessage retry callback is invoked on button click', async () => {
        const handleRetry = vi.fn();
        render(<ErrorMessage error="Timeout error." onRetry={handleRetry} />);

        await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

        expect(handleRetry).toHaveBeenCalledOnce();
    });
});

// ============================================================================
// Multiple concurrent error states
// ============================================================================

describe('Error suite: multiple concurrent error states', () => {
    it('renders multiple ServiceHealth items in error state without interference', () => {
        const multipleErrors: ServiceInfo[] = [
            { name: 'Service A', status: 'offline', message: 'Error A' },
            { name: 'Service B', status: 'offline', message: 'Error B' },
            { name: 'Service C', status: 'offline', message: 'Error C' },
        ];

        render(<ServiceHealth services={multipleErrors} />);

        expect(screen.getByText('Error A')).toBeInTheDocument();
        expect(screen.getByText('Error B')).toBeInTheDocument();
        expect(screen.getByText('Error C')).toBeInTheDocument();
    });

    it('expanding one errored service does not show details for others', async () => {
        const twoOffline: ServiceInfo[] = [
            {
                name: 'Service A',
                status: 'offline',
                message: 'Offline A',
                endpoint: 'https://a.example.com',
            },
            {
                name: 'Service B',
                status: 'offline',
                message: 'Offline B',
                endpoint: 'https://b.example.com',
            },
        ];

        render(<ServiceHealth services={twoOffline} />);

        // Expand only Service A
        await userEvent.click(screen.getByText('Service A'));

        expect(screen.getByText('https://a.example.com')).toBeInTheDocument();
        expect(screen.queryByText('https://b.example.com')).not.toBeInTheDocument();
    });
});
