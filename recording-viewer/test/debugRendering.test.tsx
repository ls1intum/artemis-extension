import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventSummary } from '../src/components/TrackingTimeline';
import { EventDetail } from '../src/components/EventStream';

const debugSession: RecordedEvent = {
    type: 'debugSession', timestamp: 1000, action: 'started',
    sessionId: 's1', sessionName: 'Launch', sessionType: 'java',
};
const breakpointChange: RecordedEvent = {
    type: 'breakpointChange', timestamp: 2000, action: 'added',
    breakpoints: [{ id: 'b1', uri: 'file:///workspace/exercise1/src/Main.java', line: 9, column: 4, enabled: true }],
};

describe('debug event rendering', () => {
    it('eventSummary renders debugSession action + name', () => {
        const { container } = render(<>{eventSummary(debugSession, 0)}</>);
        expect(container.textContent).toContain('started');
        expect(container.textContent).toContain('Launch');
    });

    it('eventSummary renders breakpointChange with 1-based line', () => {
        const { container } = render(<>{eventSummary(breakpointChange, 0)}</>);
        expect(container.textContent).toContain('added');
        expect(container.textContent).toContain(':10'); // stored 0-based 9, shown 1-based
    });

    it('EventDetail renders debugSession action + name', () => {
        const { container } = render(<EventDetail event={debugSession} />);
        expect(container.textContent).toContain('started');
        expect(container.textContent).toContain('Launch');
    });

    it('EventDetail renders breakpointChange with 1-based line', () => {
        const { container } = render(<EventDetail event={breakpointChange} />);
        expect(container.textContent).toContain('added');
        expect(container.textContent).toContain(':10');
    });
});
