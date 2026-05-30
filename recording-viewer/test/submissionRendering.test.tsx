import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import type { RecordedEvent } from '../src/types';
import { eventSummary } from '../src/components/TrackingTimeline';
import { EventDetail } from '../src/components/EventStream';

const started: RecordedEvent = { type: 'submission', timestamp: 1000, status: 'started', participationId: 42, commitMessage: 'wip' };
const succeeded: RecordedEvent = { type: 'submission', timestamp: 2000, status: 'succeeded', participationId: 42, exerciseId: 7, commitMessage: 'final' };
const failed: RecordedEvent = { type: 'submission', timestamp: 3000, status: 'failed', participationId: 42, failureReason: 'merge-conflict' };

describe('submission event rendering', () => {
    it('eventSummary renders the status', () => {
        expect(render(<>{eventSummary(started, 0)}</>).container.textContent).toContain('SUBMIT');
        expect(render(<>{eventSummary(succeeded, 0)}</>).container.textContent).toContain('SUCCEEDED');
    });

    it('eventSummary renders the failure reason', () => {
        expect(render(<>{eventSummary(failed, 0)}</>).container.textContent).toContain('merge-conflict');
    });

    it('EventDetail renders the status and participation', () => {
        const text = render(<EventDetail event={succeeded} />).container.textContent ?? '';
        expect(text).toContain('SUCCEEDED');
        expect(text).toContain('42');
    });

    it('EventDetail renders the failure reason', () => {
        expect((render(<EventDetail event={failed} />).container.textContent ?? '')).toContain('merge-conflict');
    });
});
