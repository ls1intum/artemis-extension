import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AskIris } from '../../../../src/views/webview/components/AskIris/AskIris';

const defaultProps = {
	description: 'Open the Iris chat to discuss this course or get guidance.',
	onClick: vi.fn(),
};

describe('AskIris', () => {
	it('renders the "Ask Iris" heading', () => {
		render(<AskIris {...defaultProps} />);
		expect(screen.getByText('Ask Iris')).toBeInTheDocument();
	});

	it('displays the description text', () => {
		render(<AskIris {...defaultProps} />);
		expect(screen.getByText(defaultProps.description)).toBeInTheDocument();
	});

	it('renders an Ask button', () => {
		render(<AskIris {...defaultProps} />);
		expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
	});

	it('calls onClick handler when Ask button is clicked', async () => {
		const handleClick = vi.fn();
		render(<AskIris description={defaultProps.description} onClick={handleClick} />);

		await userEvent.click(screen.getByRole('button', { name: 'Ask' }));

		expect(handleClick).toHaveBeenCalledOnce();
	});

	it('renders the Iris logo image', () => {
		const { container } = render(<AskIris {...defaultProps} />);
		const img = container.querySelector('img');
		expect(img).toBeInTheDocument();
	});
});
