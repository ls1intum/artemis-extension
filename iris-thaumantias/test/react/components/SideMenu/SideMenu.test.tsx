import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SideMenu } from '../../../../src/views/webview/components/SideMenu/SideMenu';

const defaultChildren = (
	<nav>
		<ul>
			<li><a href="#home">Home</a></li>
			<li><a href="#settings">Settings</a></li>
		</ul>
	</nav>
);

describe('SideMenu', () => {
	it('renders children content when open', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()}>
				<p>Menu content</p>
			</SideMenu>
		);
		expect(screen.getByText('Menu content')).toBeInTheDocument();
	});

	it('renders title when provided', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()} title="Navigation">
				<p>Content</p>
			</SideMenu>
		);
		expect(screen.getByText('Navigation')).toBeInTheDocument();
	});

	it('does not render title when not provided', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()}>
				<p>Content</p>
			</SideMenu>
		);
		expect(screen.queryByRole('heading')).not.toBeInTheDocument();
	});

	it('calls onClose when Close button clicked', async () => {
		const handleClose = vi.fn();
		render(
			<SideMenu isOpen={true} onClose={handleClose}>
				<p>Content</p>
			</SideMenu>
		);

		await userEvent.click(screen.getByRole('button', { name: 'Close Menu' }));

		expect(handleClose).toHaveBeenCalledOnce();
	});

	it('calls onClose when backdrop overlay clicked', async () => {
		const handleClose = vi.fn();
		const { container } = render(
			<SideMenu isOpen={true} onClose={handleClose}>
				<p>Content</p>
			</SideMenu>
		);

		// The overlay is the first div — click it directly
		const overlay = container.firstChild as HTMLElement;
		await userEvent.click(overlay);

		expect(handleClose).toHaveBeenCalledOnce();
	});

	it('renders Close button accessible by role', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()}>
				<p>Content</p>
			</SideMenu>
		);
		expect(screen.getByRole('button', { name: 'Close Menu' })).toBeInTheDocument();
	});

	it('renders navigation items when provided as children', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()}>
				{defaultChildren}
			</SideMenu>
		);
		expect(screen.getByRole('navigation')).toBeInTheDocument();
		expect(screen.getByText('Home')).toBeInTheDocument();
		expect(screen.getByText('Settings')).toBeInTheDocument();
	});

	it('renders correctly in closed state (structure present but CSS drives visibility)', () => {
		render(
			<SideMenu isOpen={false} onClose={vi.fn()}>
				<p>Hidden content</p>
			</SideMenu>
		);
		// Children are still in DOM (CSS controls visibility), component doesn't conditionally render
		expect(screen.getByText('Hidden content')).toBeInTheDocument();
	});

	it('renders exactly one close button', () => {
		render(
			<SideMenu isOpen={true} onClose={vi.fn()}>
				<p>Content</p>
			</SideMenu>
		);
		const closeButtons = screen.getAllByRole('button', { name: 'Close Menu' });
		expect(closeButtons).toHaveLength(1);
	});
});
