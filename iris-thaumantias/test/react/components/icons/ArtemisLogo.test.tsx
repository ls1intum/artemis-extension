import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArtemisLogo } from '../../../../src/views/webview/react/components/icons/ArtemisLogo';

describe('ArtemisLogo', () => {
	it('renders an SVG element', () => {
		const { container } = render(<ArtemisLogo />);
		const svg = container.querySelector('svg');
		expect(svg).toBeInTheDocument();
	});

	it('renders with default size (24)', () => {
		const { container } = render(<ArtemisLogo />);
		const svg = container.querySelector('svg');
		expect(svg).toHaveAttribute('width', '24');
		expect(svg).toHaveAttribute('height', '24');
	});

	it('accepts custom size prop', () => {
		const { container } = render(<ArtemisLogo size={48} />);
		const svg = container.querySelector('svg');
		expect(svg).toHaveAttribute('width', '48');
		expect(svg).toHaveAttribute('height', '48');
	});

	it('renders two path elements (arrow and triangle)', () => {
		const { container } = render(<ArtemisLogo />);
		const paths = container.querySelectorAll('path');
		expect(paths).toHaveLength(2);
	});

	it('applies custom className when provided', () => {
		const { container } = render(<ArtemisLogo className="logo-icon" />);
		const svg = container.querySelector('svg');
		expect(svg).toHaveAttribute('class', 'logo-icon');
	});
});
