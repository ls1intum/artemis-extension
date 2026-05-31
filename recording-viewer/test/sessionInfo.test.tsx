import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SessionInfo } from '../src/components/SessionInfo';
import { ALL_EVENT_TYPES } from '../src/constants';
import type { LoadedSession, RecordedEvent } from '../src/types';

const ev = (type: string, timestamp: number) => ({ type, timestamp } as unknown as RecordedEvent);

function makeSession(events: RecordedEvent[]): LoadedSession {
    return { metadata: null, events, fileName: 'test-session', schemaVersion: 1 };
}

describe('SessionInfo event breakdown', () => {
    it('lists every event type, active ones first (curated order) then empty ones', () => {
        // sessionStart is index 0 of ALL_EVENT_TYPES, save is later — so active
        // order should be [sessionStart, save] regardless of count.
        const session = makeSession([
            ev('sessionStart', 1),
            ev('save', 2),
            ev('sessionStart', 3),
        ]);
        const { container } = render(<SessionInfo session={session} />);
        const rows = container.querySelectorAll('.event-breakdown .event-count-row');

        // Every type is shown.
        expect(rows.length).toBe(ALL_EVENT_TYPES.length);

        // Active types come first, in curated order, with their counts.
        expect(rows[0].textContent).toContain('sessionStart');
        expect(rows[0].textContent).toContain('2');
        expect(rows[0].classList.contains('empty')).toBe(false);
        expect(rows[1].textContent).toContain('save');
        expect(rows[1].textContent).toContain('1');
        expect(rows[1].classList.contains('empty')).toBe(false);

        // Everything after the two active types is empty (count 0).
        const emptyRows = container.querySelectorAll('.event-breakdown .event-count-row.empty');
        expect(emptyRows.length).toBe(ALL_EVENT_TYPES.length - 2);
        expect(rows[2].classList.contains('empty')).toBe(true);
        expect(rows[2].textContent).toContain('0');
    });
});
