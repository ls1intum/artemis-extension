import { describe, expect, it } from 'vitest';

import { checkinState, episodeIsOpen, isStaleCheck } from '@webview/views/IrisChat/components/checkinState';
import type { ChatMessage } from '@webview/views/IrisChat/types';

const base: ChatMessage = {
    localId: 'l1', role: 'assistant', origin: 'proactive', content: 'q', timestamp: 0, proactiveEpisodeId: 'ep',
};

describe('episodeIsOpen', () => {
    it('open when live, not folded, no terminal outcome', () => {
        expect(episodeIsOpen('ep', true, { folded: false })).toBe(true);
    });
    it('NOT open once a terminal outcome exists even if folded is still false (order-B grace window)', () => {
        expect(episodeIsOpen('ep', true, { folded: false, outcome: 'RECOVERED' })).toBe(false);
    });
    it('NOT open when folded', () => {
        expect(episodeIsOpen('ep', true, { folded: true })).toBe(false);
    });
    it('NOT open when not live (reloaded)', () => {
        expect(episodeIsOpen('ep', false, undefined)).toBe(false);
    });
});

describe('isStaleCheck', () => {
    it('true from a live binding', () => {
        expect(isStaleCheck(base, true)).toBe(true);
    });
    it('true from a reloaded proactiveKind', () => {
        expect(isStaleCheck({ ...base, proactiveKind: 'stale-check' }, false)).toBe(true);
    });
    it('false for a plain hint', () => {
        expect(isStaleCheck(base, false)).toBe(false);
    });
});

describe('checkinState', () => {
    it('solved when the answer is solved', () => {
        expect(checkinState({ message: { ...base, staleAnswer: 'solved' }, isLatestInEpisode: true, episodeOpen: true })).toBe('solved');
    });
    it('still-working for still-on-it or something-else', () => {
        expect(checkinState({ message: base, liveAnswer: 'still-on-it', isLatestInEpisode: true, episodeOpen: true })).toBe('still-working');
        expect(checkinState({ message: base, liveAnswer: 'something-else', isLatestInEpisode: true, episodeOpen: true })).toBe('still-working');
    });
    it('pending when unanswered, latest, and episode open', () => {
        expect(checkinState({ message: base, isLatestInEpisode: true, episodeOpen: true })).toBe('pending');
    });
    it('ignored when unanswered and NOT latest (superseded)', () => {
        expect(checkinState({ message: base, isLatestInEpisode: false, episodeOpen: true })).toBe('ignored');
    });
    it('ignored when unanswered, latest, but episode not open', () => {
        expect(checkinState({ message: base, isLatestInEpisode: true, episodeOpen: false })).toBe('ignored');
    });
    it('prefers a stored staleAnswer over a live answer', () => {
        expect(checkinState({ message: { ...base, staleAnswer: 'solved' }, liveAnswer: 'still-on-it', isLatestInEpisode: true, episodeOpen: true })).toBe('solved');
    });
});
