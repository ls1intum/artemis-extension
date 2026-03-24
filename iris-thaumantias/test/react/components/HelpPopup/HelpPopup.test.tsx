import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpPopup } from '../../../../src/webview/components/HelpPopup/HelpPopup';

describe('HelpPopup', () => {
	it('renders the default trigger help button', () => {
		render(<HelpPopup>Help content here</HelpPopup>);
		expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
	});

	it('does not show popup content by default', () => {
		render(<HelpPopup>Help text</HelpPopup>);
		expect(screen.queryByText('Help text')).not.toBeInTheDocument();
	});

	it('displays popup content after clicking trigger button', async () => {
		render(<HelpPopup>Helpful information</HelpPopup>);

		await userEvent.click(screen.getByRole('button', { name: 'Help' }));

		expect(screen.getByText('Helpful information')).toBeInTheDocument();
	});

	it('renders in controlled open state when isOpen=true', () => {
		render(
			<HelpPopup isOpen={true} onToggle={vi.fn()}>
				Always visible
			</HelpPopup>
		);
		expect(screen.getByText('Always visible')).toBeInTheDocument();
	});

	it('calls onToggle when trigger is clicked in controlled mode', async () => {
		const handleToggle = vi.fn();
		render(
			<HelpPopup isOpen={false} onToggle={handleToggle}>
				Content
			</HelpPopup>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Help' }));

		expect(handleToggle).toHaveBeenCalledOnce();
	});
});
