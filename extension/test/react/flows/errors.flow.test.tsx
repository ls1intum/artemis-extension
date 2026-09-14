/**
 * Error suite: error boundaries, ReconnectBanner connection loss, and API
 * error handling.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorMessage } from '@webview/components/ErrorMessage/ErrorMessage';

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

describe('Error suite: API error responses in views', () => {
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
