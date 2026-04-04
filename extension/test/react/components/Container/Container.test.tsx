import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Container } from '../../../../src/webview/components/Container/Container';

describe('Container', () => {
	it('renders children content', () => {
		render(<Container>Main content</Container>);
		expect(screen.getByText('Main content')).toBeInTheDocument();
	});

	it('renders as a div element', () => {
		render(<Container testId="my-container">Content</Container>);
		const container = screen.getByTestId('my-container');
		expect(container.tagName).toBe('DIV');
	});

	it('renders optional header when provided', () => {
		render(<Container header={<span>Section Title</span>}>Body</Container>);
		expect(screen.getByText('Section Title')).toBeInTheDocument();
	});

	it('renders optional footer when provided', () => {
		render(<Container footer={<span>Footer text</span>}>Body</Container>);
		expect(screen.getByText('Footer text')).toBeInTheDocument();
	});

	it('does not render header section when header prop is absent', () => {
		render(<Container testId="no-header">Body only</Container>);
		expect(screen.queryByText('Header')).not.toBeInTheDocument();
	});

	it('renders optional toolbar when provided', () => {
		render(<Container toolbar={<button>Action</button>}>Body</Container>);
		expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
	});
});
