import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TextInput } from '@webview/components/TextInput/TextInput';

describe('TextInput', () => {
	it('renders with label associated to input', () => {
		render(<TextInput value="" onChange={vi.fn()} label="Username" id="username" />);
		const label = screen.getByText('Username');
		const input = screen.getByLabelText('Username');
		expect(label).toBeInTheDocument();
		expect(input).toBeInTheDocument();
	});

	it('calls onChange when typing', async () => {
		const handleChange = vi.fn();
		render(<TextInput value="" onChange={handleChange} label="Name" id="name" />);

		await userEvent.type(screen.getByLabelText('Name'), 'hello');

		// onChange is called once per keypress with the character typed
		expect(handleChange).toHaveBeenCalledTimes(5);
		expect(handleChange).toHaveBeenCalledWith('h');
		expect(handleChange).toHaveBeenLastCalledWith('o');
	});

	it('shows error message when error prop provided', () => {
		render(
			<TextInput
				value=""
				onChange={vi.fn()}
				label="Email"
				id="email"
				error="Invalid email address"
			/>
		);
		expect(screen.getByText('Invalid email address')).toBeInTheDocument();
	});

	it('marks input as invalid when error provided', () => {
		render(
			<TextInput value="" onChange={vi.fn()} label="Email" id="email" error="Required" />
		);
		const input = screen.getByLabelText('Email');
		expect(input).toHaveAttribute('aria-invalid', 'true');
	});

	it('disables input when disabled prop is true', () => {
		render(<TextInput value="" onChange={vi.fn()} label="Field" id="field" disabled />);
		expect(screen.getByLabelText('Field')).toBeDisabled();
	});

	it('handles placeholder text', () => {
		render(
			<TextInput value="" onChange={vi.fn()} placeholder="Enter your name" />
		);
		expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument();
	});

	it('renders password type with hidden value by default', () => {
		render(
			<TextInput value="secret" onChange={vi.fn()} type="password" label="Password" id="pwd" />
		);
		const input = screen.getByLabelText('Password');
		expect(input).toHaveAttribute('type', 'password');
	});

	it('toggles password visibility', async () => {
		render(
			<TextInput value="secret" onChange={vi.fn()} type="password" label="Password" id="pwd" />
		);

		const toggle = screen.getByRole('button', { name: 'Toggle password visibility' });
		expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

		await userEvent.click(toggle);

		expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
	});

	it('shows required indicator when required is true', () => {
		render(
			<TextInput value="" onChange={vi.fn()} label="Required Field" id="req" required />
		);
		const input = screen.getByLabelText(/Required Field/);
		expect(input).toHaveAttribute('required');
		expect(screen.getByText('*')).toBeInTheDocument();
	});

	it('calls onBlur when input loses focus', async () => {
		const handleBlur = vi.fn();
		render(
			<TextInput value="" onChange={vi.fn()} label="Field" id="field" onBlur={handleBlur} />
		);

		const input = screen.getByLabelText('Field');
		await userEvent.click(input);
		await userEvent.tab();

		expect(handleBlur).toHaveBeenCalledOnce();
	});

	it('calls onFocus when input gains focus', async () => {
		const handleFocus = vi.fn();
		render(
			<TextInput value="" onChange={vi.fn()} label="Field" id="field" onFocus={handleFocus} />
		);

		await userEvent.click(screen.getByLabelText('Field'));

		expect(handleFocus).toHaveBeenCalledOnce();
	});

	it('respects maxLength attribute', () => {
		render(
			<TextInput value="" onChange={vi.fn()} label="Short" id="short" maxLength={5} />
		);
		expect(screen.getByLabelText('Short')).toHaveAttribute('maxLength', '5');
	});

	it('shows hint text when hint prop provided', () => {
		render(
			<TextInput value="" onChange={vi.fn()} label="Field" id="field" hint="Must be at least 8 characters" />
		);
		expect(screen.getByText('Must be at least 8 characters')).toBeInTheDocument();
	});

	it('calls onKeyDown handler when key pressed', async () => {
		const handleKeyDown = vi.fn();
		render(
			<TextInput value="" onChange={vi.fn()} label="Field" id="field" onKeyDown={handleKeyDown} />
		);

		await userEvent.type(screen.getByLabelText('Field'), '{Enter}');

		expect(handleKeyDown).toHaveBeenCalled();
	});
	it('renders a bare input with no wrapper when there is nothing to annotate', () => {
		// The wrapper is a layout container for label, error and hint. Adding it
		// to a field that has none of them would change its spacing.
		const { container } = render(
			<TextInput value="" onChange={vi.fn()} placeholder="Search" testId="bare" />
		);

		expect(container.firstChild).toBe(screen.getByTestId('bare'));
	});

	it('generates an id that survives a re-render, and links the label to it', () => {
		// This is what useId buys over a random id: a random one is regenerated on
		// every render, so htmlFor points somewhere new each time even though
		// nothing about the field has changed.
		const { rerender } = render(<TextInput value="" onChange={vi.fn()} label="Generated" />);
		const firstId = screen.getByLabelText('Generated').id;
		expect(firstId).not.toBe('');
		expect(screen.getByText('Generated')).toHaveAttribute('for', firstId);

		rerender(<TextInput value="changed" onChange={vi.fn()} label="Generated" />);

		expect(screen.getByLabelText('Generated').id).toBe(firstId);
	});

	it('treats an empty id as no id rather than rendering one', () => {
		render(<TextInput value="" onChange={vi.fn()} label="Empty" id="" error="Required" />);
		const input = screen.getByLabelText('Empty');

		expect(input.id).not.toBe('');
		expect(input).toHaveAttribute('aria-describedby', `${input.id}-error`);
	});

	it('offers the password toggle on a bare field and on an annotated one', async () => {
		const { rerender } = render(
			<TextInput value="secret" onChange={vi.fn()} type="password" testId="bare-pwd" />
		);
		expect(screen.getByLabelText('Toggle password visibility')).toBeInTheDocument();
		expect(screen.getByTestId('bare-pwd')).toHaveAttribute('type', 'password');

		await userEvent.click(screen.getByLabelText('Toggle password visibility'));
		expect(screen.getByTestId('bare-pwd')).toHaveAttribute('type', 'text');

		rerender(
			<TextInput value="secret" onChange={vi.fn()} type="password" label="With label" testId="labelled-pwd" />
		);
		expect(screen.getByLabelText('Toggle password visibility')).toBeInTheDocument();
	});
});
