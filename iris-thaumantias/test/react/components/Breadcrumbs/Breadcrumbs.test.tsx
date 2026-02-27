import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumbs } from '../../../../src/views/webview/react/components/Breadcrumbs/Breadcrumbs';

const segments = [
	{ label: 'Home', onClick: vi.fn() },
	{ label: 'Courses', onClick: vi.fn() },
	{ label: 'Exercise 1', onClick: vi.fn() },
];

describe('Breadcrumbs', () => {
	it('renders a navigation landmark', () => {
		render(<Breadcrumbs segments={segments} />);
		expect(screen.getByRole('navigation', { name: 'Breadcrumb navigation' })).toBeInTheDocument();
	});

	it('renders all segment labels', () => {
		render(<Breadcrumbs segments={segments} />);
		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Courses')).toBeInTheDocument();
		expect(screen.getByText('Exercise 1')).toBeInTheDocument();
	});

	it('marks the last segment as current page with aria-current', () => {
		render(<Breadcrumbs segments={segments} />);
		const currentPage = screen.getByText('Exercise 1');
		expect(currentPage).toHaveAttribute('aria-current', 'page');
	});

	it('renders non-last segments as clickable buttons', () => {
		render(<Breadcrumbs segments={segments} />);
		expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Courses' })).toBeInTheDocument();
	});

	it('calls onClick handler when a breadcrumb button is clicked', async () => {
		const homeClick = vi.fn();
		render(<Breadcrumbs segments={[
			{ label: 'Home', onClick: homeClick },
			{ label: 'Current', onClick: vi.fn() },
		]} />);

		await userEvent.click(screen.getByRole('button', { name: 'Home' }));

		expect(homeClick).toHaveBeenCalledOnce();
	});

	it('returns null when segments array is empty', () => {
		const { container } = render(<Breadcrumbs segments={[]} />);
		expect(container.firstChild).toBeNull();
	});
});
