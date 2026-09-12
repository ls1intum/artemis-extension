import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EarlierHintsGroup } from '@webview/views/IrisChat/components/EarlierHintsGroup';
import type { ChatRenderItem } from '@webview/views/IrisChat/components/groupProactiveMessages';

const episode = (episodeId: string): ChatRenderItem => ({ kind: 'episode', episodeId, messages: [] });

function renderGroup(items: ChatRenderItem[]) {
    return render(
        <EarlierHintsGroup
            items={items}
            renderFoldLine={(item) => (
                <div key={item.kind === 'episode' ? item.episodeId : 'x'}>
                    fold-{item.kind === 'episode' ? item.episodeId : 'x'}
                </div>
            )}
        />,
    );
}

describe('EarlierHintsGroup', () => {
    it('shows a collapsed "N earlier hints" summary and hides the fold lines by default', () => {
        renderGroup([episode('A'), episode('B'), episode('C')]);
        expect(screen.getByRole('button', { name: /3 earlier hints/i })).toHaveAttribute('aria-expanded', 'false');
        expect(screen.queryByText('fold-A')).toBeNull();
        expect(screen.queryByText('fold-C')).toBeNull();
    });

    it('expands to reveal every fold line when the summary is clicked', () => {
        renderGroup([episode('A'), episode('B'), episode('C')]);
        fireEvent.click(screen.getByRole('button', { name: /3 earlier hints/i }));
        expect(screen.getByRole('button', { name: /3 earlier hints/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByText('fold-A')).toBeInTheDocument();
        expect(screen.getByText('fold-B')).toBeInTheDocument();
        expect(screen.getByText('fold-C')).toBeInTheDocument();
    });

    it('pluralizes the count (two hints -> "hints")', () => {
        renderGroup([episode('A'), episode('B')]);
        expect(screen.getByRole('button', { name: '2 earlier hints' })).toBeInTheDocument();
    });
});
