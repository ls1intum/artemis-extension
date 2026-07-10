import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SessionInfo } from '../src/components/SessionInfo';
import { ALL_EVENT_TYPES_WITH_LEGACY } from '../src/constants';
import type { LoadedSession, RecordedEvent } from '../src/types';

const ev = (type: string, timestamp: number) => ({ type, timestamp } as unknown as RecordedEvent);

function makeSession(events: RecordedEvent[]): LoadedSession {
    return { metadata: null, events, fileName: 'test-session', schemaVersion: 1 };
}

describe('SessionInfo event breakdown', () => {
    it('lists every event type, active ones first (curated order) then empty ones', () => {
        // sessionStart is index 0 of ALL_EVENT_TYPES, save is later — so active
        // order should be [sessionStart, save] regardless of count.
        const events = [
            ev('sessionStart', 1),
            ev('save', 2),
            ev('sessionStart', 3),
        ];
        const session = makeSession(events);
        const { container } = render(<SessionInfo session={session} events={events} />);
        const rows = container.querySelectorAll('.event-breakdown .event-count-row');

        // Every type is shown.
        expect(rows.length).toBe(ALL_EVENT_TYPES_WITH_LEGACY.length);

        // Active types come first, in curated order, with their counts.
        expect(rows[0].textContent).toContain('sessionStart');
        expect(rows[0].textContent).toContain('2');
        expect(rows[0].classList.contains('empty')).toBe(false);
        expect(rows[1].textContent).toContain('save');
        expect(rows[1].textContent).toContain('1');
        expect(rows[1].classList.contains('empty')).toBe(false);

        // Everything after the two active types is empty (count 0).
        const emptyRows = container.querySelectorAll('.event-breakdown .event-count-row.empty');
        expect(emptyRows.length).toBe(ALL_EVENT_TYPES_WITH_LEGACY.length - 2);
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

    it('counts legacy study-era event types (eqSnapshot, intervention) in the breakdown', () => {
        // Old study recordings still contain eqSnapshot/eqEngineState/intervention
        // rows (retired from the live schema, see LEGACY_EVENT_TYPES in
        // constants.ts). They must show up with a real count, not silently
        // disappear from the per-type breakdown.
        const events = [
            ev('eqSnapshot', 1),
            ev('eqSnapshot', 2),
            ev('intervention', 3),
            ev('sessionStart', 4),
        ];
        const session = makeSession(events);
        const { container } = render(<SessionInfo session={session} events={events} />);
        const rows = container.querySelectorAll('.event-breakdown .event-count-row');

        expect(rows.length).toBe(ALL_EVENT_TYPES_WITH_LEGACY.length);

        const eqSnapshotRow = Array.from(rows).find(r => r.textContent?.includes('eqSnapshot'));
        expect(eqSnapshotRow).toBeDefined();
        expect(eqSnapshotRow?.textContent).toContain('2');
        expect(eqSnapshotRow?.classList.contains('empty')).toBe(false);

        const interventionRow = Array.from(rows).find(r => r.textContent?.includes('intervention'));
        expect(interventionRow).toBeDefined();
        expect(interventionRow?.textContent).toContain('1');
        expect(interventionRow?.classList.contains('empty')).toBe(false);
    });
});
