import { describe, expect, it } from 'vitest';

import { groupByEpisode } from '@webview/views/IrisChat/components/groupProactiveMessages';
import type { ChatMessage } from '@webview/views/IrisChat/types';

function msg(localId: string, overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        localId,
        role: 'assistant',
        content: `content-${localId}`,
        timestamp: 0,
        ...overrides,
    };
}

const user = (localId: string): ChatMessage => msg(localId, { role: 'user' });

const proactive = (localId: string, episodeId?: string): ChatMessage =>
    msg(localId, { role: 'assistant', origin: 'proactive', proactiveEpisodeId: episodeId });

describe('groupByEpisode', () => {
    it('renders a non-proactive message as a single', () => {
        const items = groupByEpisode([user('u1'), msg('a1')]);
        expect(items).toEqual([
            { kind: 'single', message: expect.objectContaining({ localId: 'u1' }) },
            { kind: 'single', message: expect.objectContaining({ localId: 'a1' }) },
        ]);
    });

    it('renders a proactive message with no episodeId as a single', () => {
        const items = groupByEpisode([proactive('p1')]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: 'single' });
    });

    it('folds two messages with the same episodeId into one episode group even with a chat turn between them', () => {
        const items = groupByEpisode([
            proactive('p1', 'ep-A'),
            user('u1'),
            proactive('p2', 'ep-A'),
        ]);
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({
            kind: 'episode',
            episodeId: 'ep-A',
            messages: [
                expect.objectContaining({ localId: 'p1' }),
                expect.objectContaining({ localId: 'p2' }),
            ],
        });
        expect(items[1]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'u1' }) });
    });

    it('places the episode group at the position of the first message in the episode', () => {
        const items = groupByEpisode([
            user('u1'),
            proactive('p1', 'ep-A'),
            user('u2'),
            proactive('p2', 'ep-A'),
        ]);
        // Order: u1 single, then episode at p1's position, then u2 single
        expect(items.map((i) => i.kind)).toEqual(['single', 'episode', 'single']);
        expect(items[0]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'u1' }) });
        expect(items[1]).toMatchObject({ kind: 'episode', episodeId: 'ep-A' });
        expect(items[2]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'u2' }) });
    });

    it('renders a single-message episode as a plain single (no wrap)', () => {
        const items = groupByEpisode([proactive('p1', 'ep-solo')]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'p1' }) });
    });

    it('keeps two different episodes as separate groups', () => {
        const items = groupByEpisode([
            proactive('p1', 'ep-A'),
            proactive('p2', 'ep-B'),
        ]);
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'p1' }) });
        expect(items[1]).toMatchObject({ kind: 'single', message: expect.objectContaining({ localId: 'p2' }) });
    });

    it('groups three messages in the same episode into one group', () => {
        const items = groupByEpisode([
            proactive('p1', 'ep-A'),
            proactive('p2', 'ep-A'),
            proactive('p3', 'ep-A'),
        ]);
        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({
            kind: 'episode',
            episodeId: 'ep-A',
            messages: [
                expect.objectContaining({ localId: 'p1' }),
                expect.objectContaining({ localId: 'p2' }),
                expect.objectContaining({ localId: 'p3' }),
            ],
        });
    });

    it('proactive messages without episodeId never collapse regardless of adjacency', () => {
        const items = groupByEpisode([
            proactive('p1'),
            proactive('p2'),
        ]);
        expect(items.map((i) => i.kind)).toEqual(['single', 'single']);
    });

    it('non-proactive turns stay inline and are never folded', () => {
        const items = groupByEpisode([
            user('u1'),
            msg('a1'),
            user('u2'),
        ]);
        expect(items.map((i) => i.kind)).toEqual(['single', 'single', 'single']);
    });

    it('does not mutate the input array', () => {
        const input = [proactive('p1', 'ep-A'), user('u1'), proactive('p2', 'ep-A')];
        const copy = [...input];
        groupByEpisode(input);
        expect(input).toEqual(copy);
    });

    it('is order-stable: the episode appears at the first message position, rest in original order', () => {
        const items = groupByEpisode([
            user('u1'),
            proactive('ep-p1', 'ep-X'),
            user('u2'),
            msg('a1'),
            proactive('ep-p2', 'ep-X'),
            user('u3'),
        ]);
        // episode at position of ep-p1 (index 1 in output after u1)
        expect(items.map((i) => {
            if (i.kind === 'episode') { return `ep:${i.episodeId}`; }
            return `single:${i.message.localId}`;
        })).toEqual(['single:u1', 'ep:ep-X', 'single:u2', 'single:a1', 'single:u3']);
    });
});
