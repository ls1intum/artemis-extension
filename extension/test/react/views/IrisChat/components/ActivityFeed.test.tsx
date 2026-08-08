import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { activityLabel, prettifyActivityName } from '@webview/views/IrisChat/activityLabels';
import { ActivityFeed } from '@webview/views/IrisChat/components/ActivityFeed';

const act = (over = {}) => ({ id: 'a1', kind: 'TOOL' as const, name: 'file_lookup', state: 'RUNNING' as const, ...over });

describe('activityLabel', () => {
    it('translates a known slug', () => {
        expect(activityLabel('get_build_logs_analysis_tool')).toBe('Checking build logs');
    });
    it('prettifies an unknown slug', () => {
        expect(activityLabel('some_new_pyris_tool')).toBe('Some new pyris tool');
    });
    it('handles an empty name', () => {
        expect(prettifyActivityName('')).toBe('');
    });
});

describe('ActivityFeed', () => {
    it('renders a label per activity', () => {
        render(<ActivityFeed activities={[act(), act({ id: 'a2', name: 'repository_files' })]} mode="live" />);
        expect(screen.getByText('Reading a file')).toBeTruthy();
        expect(screen.getByText('Browsing your code')).toBeTruthy();
    });
    it('renders detail when present', () => {
        render(<ActivityFeed activities={[act({ detail: 'Submission.java' })]} mode="live" />);
        expect(screen.getByText('Submission.java')).toBeTruthy();
    });
    it('shows durations but suppresses sub-100ms', () => {
        render(<ActivityFeed mode="trail" activities={[
            act({ id: 'a1', state: 'FINISHED', durationMillis: 1200 }),
            act({ id: 'a2', state: 'FINISHED', durationMillis: 40 }),
        ]} />);
        expect(screen.getByText('1.2s')).toBeTruthy();
        expect(screen.queryByText('0.0s')).toBeNull();
    });
    it('renders nothing when empty', () => {
        const { container } = render(<ActivityFeed activities={[]} mode="live" />);
        expect(container.firstChild).toBeNull();
    });
});
