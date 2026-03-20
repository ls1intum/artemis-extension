import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThinkingIndicator } from '../../../../../src/views/webview/views/IrisChat/components/ThinkingIndicator';

describe('ThinkingIndicator', () => {
	it('renders when isVisible is true (default)', () => {
		const { container } = render(<ThinkingIndicator isVisible={true} />);
		expect(container.firstChild).toBeInTheDocument();
	});

	it('returns null when isVisible is false', () => {
		const { container } = render(<ThinkingIndicator isVisible={false} />);
		expect(container.firstChild).toBeNull();
	});

	it('renders by default (no props — isVisible defaults to true)', () => {
		const { container } = render(<ThinkingIndicator />);
		expect(container.firstChild).toBeInTheDocument();
	});

	it('renders three animated dots', () => {
		const { container } = render(<ThinkingIndicator isVisible={true} />);
		// Three span.dot elements for the animated dots
		const dots = container.querySelectorAll('span');
		expect(dots.length).toBe(3);
	});

	it('dots have staggered animation delays', () => {
		const { container } = render(<ThinkingIndicator isVisible={true} />);
		const dots = container.querySelectorAll('span');
		expect((dots[0] as HTMLElement).style.animationDelay).toBe('0s');
		expect((dots[1] as HTMLElement).style.animationDelay).toBe('0.2s');
		expect((dots[2] as HTMLElement).style.animationDelay).toBe('0.4s');
	});
});
