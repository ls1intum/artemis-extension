import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBadge } from '../src/components/EventBadge';
import { MARKER_COLORS } from '../src/constants';

describe('MARKER_COLORS (single source of truth)', () => {
    it('assigns every event type a distinct color', () => {
        const values = Object.values(MARKER_COLORS);
        expect(new Set(values).size).toBe(values.length);
    });
});

describe('EventBadge', () => {
    it('drives distinct inline colors from distinct event types', () => {
        const a = render(<EventBadge type="diagnostics" />).container.querySelector('span')!;
        const b = render(<EventBadge type="windowFocus" />).container.querySelector('span')!;
        expect(a.style.color).not.toBe('');
        expect(b.style.color).not.toBe('');
        expect(a.style.color).not.toBe(b.style.color);
    });

    it('applies an inline color for a known event type (single source of truth)', () => {
        const { container } = render(<EventBadge type="submission" />);
        const span = container.querySelector('span.event-badge')!;
        expect(span.textContent).toBe('submission');
        expect(span.classList.contains('submission')).toBe(true);
        // Known type -> inline style is present and a color is set.
        expect(span.hasAttribute('style')).toBe(true);
        expect((span as HTMLElement).style.color).not.toBe('');
    });

    it('renders a custom label while keeping the type-driven color', () => {
        const { container } = render(<EventBadge type="eqSnapshot" label="EQ" />);
        const span = container.querySelector('span.event-badge')!;
        expect(span.textContent).toBe('EQ');
        expect(span.classList.contains('eqSnapshot')).toBe(true);
        expect((span as HTMLElement).style.color).not.toBe('');
    });

    it('falls back to the CSS class (no inline color) for an unknown type like "annotation"', () => {
        const { container } = render(<EventBadge type="annotation" label="NOTE" />);
        const span = container.querySelector('span.event-badge')!;
        expect(span.textContent).toBe('NOTE');
        expect(span.classList.contains('annotation')).toBe(true);
        // Unknown key -> no inline style, so the .event-badge.annotation CSS applies.
        expect(span.hasAttribute('style')).toBe(false);
    });

    it('appends an extra className and the title attribute', () => {
        const { container } = render(<EventBadge type="save" className="extra" title="full name" />);
        const span = container.querySelector('span.event-badge')!;
        expect(span.classList.contains('extra')).toBe(true);
        expect(span.getAttribute('title')).toBe('full name');
    });
});
