import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { RaterComparisonView } from '../src/components/RaterComparisonView';
import type { Annotation } from '../src/types';

function ann(id: string, t: number, label: string, raterId = 'r_a'): Annotation {
    return { id, timestamp: t, label: label as Annotation['label'], text: '', createdAt: t, raterId, raterName: raterId };
}
// App's xDomain is OFFSET space; with sessionStartTime=1000 this maps to absolute
// [1000, 2000], so the absolute marks 1100/1200/1500 fall inside.
const xDomain: [number, number] = [0, 1000];
function lanes() {
    return [
        { raterId: 'r_a', raterName: 'Alice', annotations: [ann('a1', 1100, 'confident'), ann('a2', 1500, 'blocked')] },
        { raterId: 'r_b', raterName: 'Bob', annotations: [ann('b1', 1200, 'medium-struggle', 'r_b')] },
    ];
}

describe('RaterComparisonView', () => {
    it('shows an empty state when no struggle ratings exist', () => {
        const onlyContext = [{ raterId: 'r_a', raterName: 'Alice', annotations: [ann('a1', 1100, 'reading')] }];
        render(<RaterComparisonView researcherLanes={onlyContext} xDomain={xDomain} sessionStartTime={1000} />);
        expect(screen.getByText(/no struggle ratings/i)).toBeInTheDocument();
    });

    it('toggles between overlaid (level labels + step paths) and stacked (rater rows)', () => {
        const { container } = render(<RaterComparisonView researcherLanes={lanes()} xDomain={xDomain} sessionStartTime={1000} />);
        expect(container.querySelectorAll('.rater-level-label')).toHaveLength(5);
        expect(container.querySelectorAll('.rater-row-label')).toHaveLength(0);
        expect(container.querySelectorAll('path').length).toBeGreaterThan(0);

        fireEvent.click(screen.getByRole('button', { name: 'Stacked' }));
        expect(container.querySelectorAll('.rater-row-label')).toHaveLength(2);
        expect(container.querySelectorAll('.rater-level-label')).toHaveLength(0);
        expect(container.querySelectorAll('rect').length).toBeGreaterThan(0);
    });

    it('seeks the video to the mark timestamp on click', () => {
        const onSeekVideo = vi.fn();
        const { container } = render(
            <RaterComparisonView researcherLanes={lanes()} xDomain={xDomain} sessionStartTime={1000} onSeekVideo={onSeekVideo} />,
        );
        const circle = container.querySelector('circle');
        expect(circle).not.toBeNull();
        fireEvent.click(circle!);
        expect(onSeekVideo).toHaveBeenCalledTimes(1);
        expect(onSeekVideo).toHaveBeenCalledWith(1100); // Alice's first mark
    });
});
