import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dropdown } from '../../../../src/views/webview/react/components/Dropdown/Dropdown';

const defaultOptions = [
	{ value: 'option1', label: 'Option 1' },
	{ value: 'option2', label: 'Option 2' },
	{ value: 'option3', label: 'Option 3' },
];

describe('Dropdown', () => {
	it('renders a select element with options', () => {
		render(<Dropdown value="" onChange={vi.fn()} options={defaultOptions} />);
		const select = screen.getByRole('combobox');
		expect(select).toBeInTheDocument();
	});

	it('renders all provided options', () => {
		render(<Dropdown value="" onChange={vi.fn()} options={defaultOptions} />);
		expect(screen.getByRole('option', { name: 'Option 1' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'Option 2' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'Option 3' })).toBeInTheDocument();
	});

	it('renders with placeholder as disabled option', () => {
		render(
			<Dropdown value="" onChange={vi.fn()} options={defaultOptions} placeholder="Choose one" />
		);
		const placeholder = screen.getByRole('option', { name: 'Choose one' });
		expect(placeholder).toBeInTheDocument();
		expect(placeholder).toBeDisabled();
	});

	it('calls onChange when option selected', async () => {
		const handleChange = vi.fn();
		render(<Dropdown value="" onChange={handleChange} options={defaultOptions} />);

		await userEvent.selectOptions(screen.getByRole('combobox'), 'Option 2');

		expect(handleChange).toHaveBeenCalledWith('option2');
	});

	it('displays the currently selected option', () => {
		render(<Dropdown value="option2" onChange={vi.fn()} options={defaultOptions} />);
		const select = screen.getByRole('combobox');
		expect(select).toHaveValue('option2');
	});

	it('disables dropdown when disabled prop is true', () => {
		render(<Dropdown value="" onChange={vi.fn()} options={defaultOptions} disabled />);
		expect(screen.getByRole('combobox')).toBeDisabled();
	});

	it('does not call onChange when disabled', async () => {
		const handleChange = vi.fn();
		render(<Dropdown value="" onChange={handleChange} options={defaultOptions} disabled />);

		const select = screen.getByRole('combobox');
		expect(select).toBeDisabled();
		expect(handleChange).not.toHaveBeenCalled();
	});

	it('renders with label associated to select', () => {
		render(
			<Dropdown
				value=""
				onChange={vi.fn()}
				options={defaultOptions}
				label="Sort by"
				id="sort-dropdown"
			/>
		);
		expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
		expect(screen.getByText('Sort by')).toBeInTheDocument();
	});

	it('renders with empty options gracefully', () => {
		render(<Dropdown value="" onChange={vi.fn()} options={[]} />);
		const select = screen.getByRole('combobox');
		expect(select).toBeInTheDocument();
		expect(screen.queryAllByRole('option')).toHaveLength(0);
	});

	it('selects correct option when value changes', async () => {
		const handleChange = vi.fn();
		render(<Dropdown value="option1" onChange={handleChange} options={defaultOptions} />);

		await userEvent.selectOptions(screen.getByRole('combobox'), 'Option 3');

		expect(handleChange).toHaveBeenCalledWith('option3');
	});

	it('can be focused via keyboard Tab', async () => {
		render(<Dropdown value="" onChange={vi.fn()} options={defaultOptions} />);

		await userEvent.tab();

		expect(screen.getByRole('combobox')).toHaveFocus();
	});
});
