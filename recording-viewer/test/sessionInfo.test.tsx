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
        // sessionStart is index 0 of ALL_EVENT_TYPES and save comes later, so the
        // active order is [sessionStart, save] regardless of count.
        const events = [
            ev('sessionStart', 1),
            ev('save', 2),
            ev('sessionStart', 3),
        ];
        const session = makeSession(events);
        const { container } = render(<SessionInfo session={session} events={events} />);
        const rows = container.querySelectorAll('.event-breakdown .event-count-row');

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

    it('counts the events prop, not session.events (live mode reflects streamed events)', () => {
        // In live mode session.events stays at the open-time snapshot (here empty)
        // while events stream in via the `events` prop. The breakdown, the Events
        // total and the duration must all reflect the live events, not the snapshot.
        const session = makeSession([]);
        const liveEvents = [ev('sessionStart', 1000), ev('save', 2000), ev('sessionStart', 5000)];
        const { container } = render(<SessionInfo session={session} events={liveEvents} />);

        const rows = container.querySelectorAll('.event-breakdown .event-count-row');
        expect(rows[0].textContent).toContain('sessionStart');
        expect(rows[0].textContent).toContain('2');
        expect(rows[1].textContent).toContain('save');
        expect(rows[1].textContent).toContain('1');

        // The non-empty rows are exactly the two live types.
        const activeRows = container.querySelectorAll('.event-breakdown .event-count-row:not(.empty)');
        expect(activeRows.length).toBe(2);

        // The totals and duration also reflect the live events, not the snapshot.
        // With no metadata the info-grid values are [Start, End, Duration, Events].
        const values = container.querySelectorAll('.info-grid .value');
        expect(values[2].textContent).toBe('4s'); // duration 5000 - 1000 = 4000ms
        expect(values[3].textContent).toBe('3'); // events total
    });
});
