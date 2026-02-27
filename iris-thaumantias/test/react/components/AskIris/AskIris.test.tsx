import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskIris } from '../../../../src/views/webview/react/components/AskIris/AskIris';

describe('AskIris', () => {
	it('renders as a button', () => {
		render(<AskIris />);
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('displays default "Ask Iris" label', () => {
		render(<AskIris />);
		expect(screen.getByText('Ask Iris')).toBeInTheDocument();
	});

	it('displays custom label when provided', () => {
		render(<AskIris label="Get help from Iris" />);
		expect(screen.getByText('Get help from Iris')).toBeInTheDocument();
	});

	it('calls onClick handler when clicked', async () => {
		const handleClick = vi.fn();
		render(<AskIris onClick={handleClick} />);

		await userEvent.click(screen.getByRole('button'));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('renders SVG iris icon inside button', () => {
		const { container } = render(<AskIris />);
		const button = screen.getByRole('button');
		const svg = button.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('does not throw when onClick is not provided', async () => {
		render(<AskIris />);
		await expect(userEvent.click(screen.getByRole('button'))).resolves.toBeUndefined();
	});

	it('renders as type="button" (not submit)', () => {
		render(<AskIris />);
		expect(screen.getByRole('button')).toHaveAttribute('type', 'button');
	});

	it('can be activated with keyboard Enter', async () => {
		const handleClick = vi.fn();
		render(<AskIris onClick={handleClick} />);

		screen.getByRole('button').focus();
		await userEvent.keyboard('{Enter}');

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('can be activated with keyboard Space', async () => {
		const handleClick = vi.fn();
		render(<AskIris onClick={handleClick} />);

		screen.getByRole('button').focus();
		await userEvent.keyboard(' ');

		expect(handleClick).toHaveBeenCalledOnce();
	});
});
