import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BackLink } from '../../../../src/views/webview/components/BackLink/BackLink';

describe('BackLink', () => {
	it('renders children label text', () => {
		render(<BackLink>Go back</BackLink>);
		expect(screen.getByText('Go back')).toBeInTheDocument();
	});

	it('renders as a button element', () => {
		render(<BackLink>Back</BackLink>);
		const button = screen.getByRole('button');
		expect(button).toBeInTheDocument();
		expect(button.tagName).toBe('BUTTON');
	});

	it('calls onClick handler when clicked', async () => {
		const handleClick = vi.fn();
		render(<BackLink onClick={handleClick}>Back to list</BackLink>);

		await userEvent.click(screen.getByRole('button'));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('renders SVG chevron icon', () => {
		render(<BackLink>Back</BackLink>);
		const button = screen.getByRole('button');
		const svg = button.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('renders without onClick handler (no crash)', () => {
		render(<BackLink>Back</BackLink>);
		expect(screen.getByRole('button')).toBeInTheDocument();
	});
});
