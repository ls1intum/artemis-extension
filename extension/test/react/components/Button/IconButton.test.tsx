import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconButton } from '../../../../src/webview/components/Button/IconButton';

describe('IconButton', () => {
	it('renders icon element inside button', () => {
		render(<IconButton icon={<span>icon</span>} ariaLabel="action" />);
		const button = screen.getByRole('button', { name: 'action' });
		expect(button).toBeInTheDocument();
		expect(button).toContainElement(screen.getByText('icon'));
	});

	it('applies aria-label for accessibility', () => {
		render(<IconButton icon={<span>icon</span>} ariaLabel="Close panel" />);
		const button = screen.getByRole('button', { name: 'Close panel' });
		expect(button).toHaveAttribute('aria-label', 'Close panel');
	});

	it('calls onClick handler on click', async () => {
		const handleClick = vi.fn();
		render(<IconButton icon={<span>icon</span>} ariaLabel="Click me" onClick={handleClick} />);

		await userEvent.click(screen.getByRole('button', { name: 'Click me' }));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('does not call onClick when disabled', async () => {
		const handleClick = vi.fn();
		render(
			<IconButton icon={<span>icon</span>} ariaLabel="Disabled" onClick={handleClick} disabled />
		);

		const button = screen.getByRole('button', { name: 'Disabled' });
		expect(button).toBeDisabled();
		expect(handleClick).not.toHaveBeenCalled();
	});

	it('renders as a button element', () => {
		render(<IconButton icon={<span>icon</span>} ariaLabel="test" />);
		expect(screen.getByRole('button', { name: 'test' }).tagName).toBe('BUTTON');
	});

	it('Close preset renders with default Close aria-label', () => {
		render(<IconButton.Close />);
		const button = screen.getByRole('button', { name: 'Close' });
		expect(button).toBeInTheDocument();
	});

	it('Close preset calls onClick when clicked', async () => {
		const handleClick = vi.fn();
		render(<IconButton.Close onClick={handleClick} />);

		await userEvent.click(screen.getByRole('button', { name: 'Close' }));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('BurgerMenu preset renders with aria-expanded reflecting isOpen', () => {
		const { rerender } = render(<IconButton.BurgerMenu isOpen={false} />);
		const button = screen.getByRole('button', { name: 'Menu' });
		expect(button).toHaveAttribute('aria-expanded', 'false');

		rerender(<IconButton.BurgerMenu isOpen={true} />);
		expect(button).toHaveAttribute('aria-expanded', 'true');
	});

	it('Collapse preset exposes aria-expanded based on collapsed prop', () => {
		const { rerender } = render(<IconButton.Collapse collapsed={false} />);
		const button = screen.getByRole('button', { name: 'Toggle' });
		expect(button).toHaveAttribute('aria-expanded', 'true');

		rerender(<IconButton.Collapse collapsed={true} />);
		expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	it('Reload preset shows loading label when loading', () => {
		render(<IconButton.Reload loading />);
		const button = screen.getByRole('button', { name: 'Loading...' });
		expect(button).toBeDisabled();
	});

	it('Reload preset shows normal label and is enabled when not loading', () => {
		render(<IconButton.Reload />);
		const button = screen.getByRole('button', { name: 'Reload' });
		expect(button).not.toBeDisabled();
	});

	it('Settings preset renders with Settings aria-label', () => {
		render(<IconButton.Settings />);
		expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
	});

	it('Fullscreen preset calls onClick when clicked', async () => {
		const handleClick = vi.fn();
		render(<IconButton.Fullscreen onClick={handleClick} />);

		await userEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));

		expect(handleClick).toHaveBeenCalledOnce();
	});
});
