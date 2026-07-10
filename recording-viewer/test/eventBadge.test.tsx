import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EventBadge } from '../src/components/EventBadge';
import {
    MARKER_COLORS, LEGACY_MARKER_COLORS, ALL_MARKER_COLORS,
    ALL_EVENT_TYPES, LEGACY_EVENT_TYPES, ALL_EVENT_TYPES_WITH_LEGACY, SWIM_LANE_TYPES,
} from '../src/constants';

describe('MARKER_COLORS (single source of truth)', () => {
    it('assigns every event type a distinct color', () => {
        const values = Object.values(MARKER_COLORS);
        expect(new Set(values).size).toBe(values.length);
    });

    it('assigns every legacy event type its own distinct color too', () => {
        const values = Object.values(ALL_MARKER_COLORS);
        expect(new Set(values).size).toBe(values.length);
    });
});

// Regression guard for #legacy-events-dropped: the EQ engine's retired event
// types (eqSnapshot/eqEngineState/intervention) must stay in the
// rendered/enabled sets that App.tsx and TrackingTimeline gate on, or old
// recordings' rows silently vanish from the event-stream list and canvas
// timeline (there is no user-facing toggle to bring them back).
describe('legacy event types stay rendered/enabled', () => {
    it('are all present in ALL_EVENT_TYPES_WITH_LEGACY (drives App.tsx\'s enabled set)', () => {
        for (const type of LEGACY_EVENT_TYPES) {
            expect(ALL_EVENT_TYPES_WITH_LEGACY).toContain(type);
        }
        expect(ALL_EVENT_TYPES_WITH_LEGACY.length).toBe(ALL_EVENT_TYPES.length + LEGACY_EVENT_TYPES.length);
    });

    it('eqSnapshot keeps its own swim lane on the canvas timeline', () => {
        expect(SWIM_LANE_TYPES).toContain('eqSnapshot');
    });

    it('every legacy type has a color in LEGACY_MARKER_COLORS/ALL_MARKER_COLORS', () => {
        for (const type of LEGACY_EVENT_TYPES) {
            expect(LEGACY_MARKER_COLORS[type]).toBeTruthy();
            expect(ALL_MARKER_COLORS[type]).toBe(LEGACY_MARKER_COLORS[type]);
        }
    });
});

describe('EventBadge', () => {
    it('drives distinct inline colors from distinct event types', () => {
        const a = render(<EventBadge type="diagnostics" />).container.querySelector('span')!;
        const b = render(<EventBadge type="windowFocus" />).container.querySelector('span')!;
        expect(a.style.color).not.toBe('');
        expect(b.style.color).not.toBe('');
        // diagnostics and windowFocus used to share #fbbf24; they must now differ.
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

    it('renders a custom label and keeps its own color for the retired "eqSnapshot" legacy type', () => {
        // eqSnapshot was retired from the canonical schema (EQ engine removal)
        // and is no longer a MARKER_COLORS key, but old recordings still
        // contain eqSnapshot rows (SessionTimeline's EQ chart, the
        // event-stream list, and the canvas timeline all still render them),
        // so EventBadge resolves its color via LEGACY_MARKER_COLORS/
        // ALL_MARKER_COLORS rather than falling back to CSS-only.
        const { container } = render(<EventBadge type="eqSnapshot" label="EQ" />);
        const span = container.querySelector('span.event-badge')!;
        expect(span.textContent).toBe('EQ');
        expect(span.classList.contains('eqSnapshot')).toBe(true);
        expect(span.hasAttribute('style')).toBe(true);
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
