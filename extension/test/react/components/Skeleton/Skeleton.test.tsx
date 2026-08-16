import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '@webview/components/Skeleton/Skeleton';
import { SkeletonList } from '@webview/components/Skeleton/SkeletonList';

describe('Skeleton', () => {
	it('renders a loading placeholder element', () => {
		const { container } = render(<Skeleton />);
		const skeleton = container.firstChild as HTMLElement;
		expect(skeleton).toBeInTheDocument();
	});

	it('has aria-busy="true" to indicate loading state', () => {
		const { container } = render(<Skeleton />);
		const skeleton = container.firstChild as HTMLElement;
		expect(skeleton).toHaveAttribute('aria-busy', 'true');
	});

	it('applies custom width and height styles', () => {
		const { container } = render(<Skeleton width="200px" height="40px" />);
		const skeleton = container.firstChild as HTMLElement;
		expect(skeleton).toHaveStyle({ width: '200px', height: '40px' });
	});

	it('renders with default text variant', () => {
		const { container } = render(<Skeleton variant="text" />);
		const skeleton = container.firstChild as HTMLElement;
		expect(skeleton).toBeInTheDocument();
	});
});

describe('SkeletonList', () => {
	it('renders the default number of skeleton items (5)', () => {
		const { container } = render(<SkeletonList />);
		const skeletons = container.querySelectorAll('[aria-busy="true"]');
		// Each list item has 3 skeletons (1 circular + 2 content lines)
		expect(skeletons.length).toBe(15);
	});

	it('renders the specified count of list items', () => {
		const { container } = render(<SkeletonList count={3} />);
		const skeletons = container.querySelectorAll('[aria-busy="true"]');
		// 3 items × 3 skeletons each = 9
		expect(skeletons.length).toBe(9);
	});

	it('renders a single item when count is 1', () => {
		const { container } = render(<SkeletonList count={1} />);
		const skeletons = container.querySelectorAll('[aria-busy="true"]');
		expect(skeletons.length).toBe(3);
	});
});
