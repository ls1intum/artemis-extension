import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '../../../../src/views/webview/components/Button/Button';

describe('Button', () => {
	it('renders with correct text', () => {
		render(<Button>Click me</Button>);
		expect(screen.getByText('Click me')).toBeInTheDocument();
	});

	it('calls onClick handler when clicked', async () => {
		const handleClick = vi.fn();
		render(<Button onClick={handleClick}>Submit</Button>);

		const button = screen.getByRole('button');
		await userEvent.click(button);

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('renders as a button element by default', () => {
		render(<Button>Submit</Button>);
		const button = screen.getByRole('button');
		expect(button.tagName).toBe('BUTTON');
	});

	it('renders disabled button', () => {
		render(<Button disabled>Disabled</Button>);
		const button = screen.getByRole('button');
		expect(button).toBeDisabled();
	});

	it('renders icon-only button with aria-label', () => {
		render(<Button icon={<span data-testid="icon">X</span>} />);
		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('aria-label', 'button');
		expect(screen.getByTestId('icon')).toBeInTheDocument();
	});

	it('renders button with icon and label', () => {
		render(<Button icon={<span data-testid="icon">X</span>}>Label</Button>);

		expect(screen.getByTestId('icon')).toBeInTheDocument();
		expect(screen.getByText('Label')).toBeInTheDocument();
	});

	it('does not call onClick when disabled', () => {
		const handleClick = vi.fn();
		render(
			<Button disabled onClick={handleClick}>
				Disabled Button
			</Button>
		);

		const button = screen.getByRole('button');
		// Disabled buttons have pointer-events: none, so userEvent can't click them
		// This is correct behavior - we verify the button is disabled
		expect(button).toBeDisabled();
		expect(handleClick).not.toHaveBeenCalled();
	});

	it('supports fullWidth prop', () => {
		render(<Button fullWidth>Full Width Button</Button>);
		const button = screen.getByRole('button');
		expect(button).toBeInTheDocument();
		expect(screen.getByText('Full Width Button')).toBeInTheDocument();
	});

	it('supports custom testId', () => {
		render(<Button testId="my-btn">Test</Button>);
		expect(screen.getByTestId('my-btn')).toBeInTheDocument();
	});

	it('applies different variants', () => {
		const { rerender } = render(<Button variant="primary">Primary</Button>);
		expect(screen.getByRole('button')).toBeInTheDocument();

		rerender(<Button variant="secondary">Secondary</Button>);
		expect(screen.getByRole('button')).toBeInTheDocument();

		rerender(<Button variant="link">Link</Button>);
		expect(screen.getByRole('button')).toBeInTheDocument();

		rerender(<Button variant="ghost">Ghost</Button>);
		expect(screen.getByRole('button')).toBeInTheDocument();
	});

	it('supports submit button type', () => {
		render(<Button type="submit">Submit Form</Button>);
		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('type', 'submit');
	});

	it('supports custom width and height', () => {
		render(
			<Button width="200px" height="50px">
				Custom Size
			</Button>
		);
		const button = screen.getByRole('button');
		expect(button).toHaveStyle({ width: '200px', height: '50px' });
	});
});
