import type { ChatMessage } from '@webview/views/IrisChat/types';

/**
 * One renderable row in the chat list.
 *
 * `single` is any message rendered as its own bubble. `episode` groups ALL
 * proactive messages sharing the same `proactiveEpisodeId` regardless of
 * whether non-proactive turns sit between them (C6). An open episode renders all
 * its messages as one block; a folded episode collapses to a single summary line.
 */
export type ChatRenderItem =
    | { kind: 'single'; message: ChatMessage }
    | { kind: 'episode'; episodeId: string; messages: ChatMessage[] };

const isProactive = (m: ChatMessage): boolean =>
    m.role === 'assistant' && m.origin === 'proactive';

/**
 * Groups proactive messages by `proactiveEpisodeId` into collapsible episode
 * groups, regardless of whether non-proactive turns sit between them. All
 * messages sharing the same episodeId collapse into one `{kind:'episode'}`
 * group placed at the position of the FIRST message in that episode.
 *
 * Rules:
 * - Proactive messages WITH an episodeId: grouped by id into `{kind:'episode'}`
 *   (or `{kind:'single'}` when only one message carries that id).
 * - Proactive messages WITHOUT an episodeId: rendered as `{kind:'single'}`.
 * - Non-proactive messages (user turns, normal assistant replies): always
 *   rendered as `{kind:'single'}`, never folded.
 *
 * Pure and order-stable; never mutates the input.
 */
export function groupByEpisode(messages: ChatMessage[]): ChatRenderItem[] {
    // Pre-group all proactive messages by episodeId (preserving order).
    const episodeMap = new Map<string, ChatMessage[]>();
    for (const m of messages) {
        if (isProactive(m) && m.proactiveEpisodeId) {
            const existing = episodeMap.get(m.proactiveEpisodeId);
            if (existing) {
                existing.push(m);
            } else {
                episodeMap.set(m.proactiveEpisodeId, [m]);
            }
        }
    }

    const items: ChatRenderItem[] = [];
    const emittedEpisodes = new Set<string>();

    for (const m of messages) {
        if (isProactive(m) && m.proactiveEpisodeId) {
            const episodeId = m.proactiveEpisodeId;
            if (!emittedEpisodes.has(episodeId)) {
                emittedEpisodes.add(episodeId);
                const msgs = episodeMap.get(episodeId)!;
                if (msgs.length === 1) {
                    items.push({ kind: 'single', message: msgs[0] });
                } else {
                    items.push({ kind: 'episode', episodeId, messages: msgs });
                }
            }
            // Already emitted as part of the episode group above; skip.
        } else {
            items.push({ kind: 'single', message: m });
        }
    }

    return items;
}

