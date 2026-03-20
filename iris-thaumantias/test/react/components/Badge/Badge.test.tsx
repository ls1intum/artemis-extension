import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../../../../src/views/webview/components/Badge/Badge';

describe('Badge', () => {
	it('renders children text content', () => {
		render(<Badge>New</Badge>);
		expect(screen.getByText('New')).toBeInTheDocument();
	});

	it('renders as a span element', () => {
		render(<Badge>Status</Badge>);
		const badge = screen.getByText('Status');
		expect(badge.tagName).toBe('SPAN');
	});

	it('renders with default variant when no variant prop provided', () => {
		render(<Badge>Default</Badge>);
		expect(screen.getByText('Default')).toBeInTheDocument();
	});

	it('renders with explicit variant prop', () => {
		render(<Badge variant="success">Done</Badge>);
		expect(screen.getByText('Done')).toBeInTheDocument();
	});

	it('renders with all supported variants without errors', () => {
		const { rerender } = render(<Badge variant="default">Default</Badge>);
		expect(screen.getByText('Default')).toBeInTheDocument();

		rerender(<Badge variant="success">Success</Badge>);
		expect(screen.getByText('Success')).toBeInTheDocument();

		rerender(<Badge variant="warning">Warning</Badge>);
		expect(screen.getByText('Warning')).toBeInTheDocument();

		rerender(<Badge variant="error">Error</Badge>);
		expect(screen.getByText('Error')).toBeInTheDocument();

		rerender(<Badge variant="info">Info</Badge>);
		expect(screen.getByText('Info')).toBeInTheDocument();

		rerender(<Badge variant="muted">Muted</Badge>);
		expect(screen.getByText('Muted')).toBeInTheDocument();
	});
});
