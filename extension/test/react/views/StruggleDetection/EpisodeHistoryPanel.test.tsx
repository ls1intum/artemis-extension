import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { EpisodeHistoryEntry } from '@shared/messageContracts';

import { EpisodeHistoryPanel } from '@webview/views/StruggleDetection/EpisodeHistoryPanel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_MS = 1_700_000_000_000;

function makeEntry(overrides: Partial<EpisodeHistoryEntry> = {}): EpisodeHistoryEntry {
    return {
        episodeId: 'ep-test',
        peakLevel: 'active',
        outcome: 'DISMISSED',
        hintCount: 1,
        durationMs: 60_000,
        startedAtMs: BASE_MS,
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EpisodeHistoryPanel', () => {
    it('renders two entries with id, outcome chip, and mmss duration; newest first', () => {
        const entries: EpisodeHistoryEntry[] = [
            makeEntry({
                episodeId: 'ep-first',
                outcome: 'DISMISSED',
                durationMs: 60_000,      // 1:00
                startedAtMs: BASE_MS,
            }),
            makeEntry({
                episodeId: 'ep-second',
                outcome: 'RECOVERED',
                durationMs: 1_200_000,   // 20:00
                startedAtMs: BASE_MS + 70_000,
            }),
        ];

        render(<EpisodeHistoryPanel episodes={entries} />);

        // Both episode IDs are visible.
        expect(screen.getByText('ep-first')).toBeInTheDocument();
        expect(screen.getByText('ep-second')).toBeInTheDocument();

        // Outcome chips are rendered as text.
        expect(screen.getByText('DISMISSED')).toBeInTheDocument();
        expect(screen.getByText('RECOVERED')).toBeInTheDocument();

        // Duration in M:SS format is rendered.
        expect(screen.getByText('1:00')).toBeInTheDocument();
        expect(screen.getByText('20:00')).toBeInTheDocument();

        // Newest-first: ep-second (pushed later) must appear before ep-first in DOM.
        const allText = document.body.textContent ?? '';
        expect(allText.indexOf('ep-second')).toBeLessThan(allText.indexOf('ep-first'));
    });

    it('renders the empty-state message when episodes array is empty', () => {
        render(<EpisodeHistoryPanel episodes={[]} />);
        expect(screen.getByText('No episodes yet this session.')).toBeInTheDocument();
    });
});
