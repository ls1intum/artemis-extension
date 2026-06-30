import type { ChatMessage } from '@webview/views/IrisChat/types';

/**
 * One renderable row in the chat list.
 *
 * `single` is any message rendered as its own bubble. `proactive-run` is a
 * maximal run of consecutive proactive Iris messages (no student turn between
 * them): the run collapses to its latest suggestion, with the earlier ones
 * tucked behind an expandable toggle so repeated nags about the same situation
 * do not clutter the chat. The engine intentionally re-alerts while a struggle
 * persists; this only changes the *display*, never the detection.
 *
 * `episode` groups ALL proactive messages sharing the same `proactiveEpisodeId`
 * regardless of whether non-proactive turns sit between them (C6). The latest
 * message is visible; earlier ones hide behind the same expand toggle.
 */
export type ChatRenderItem =
    | { kind: 'single'; message: ChatMessage }
    | { kind: 'proactive-run'; earlier: ChatMessage[]; latest: ChatMessage }
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
                    // Single-message episode renders as a plain single.
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

/**
 * Groups consecutive proactive messages into a single collapsible run. Any
 * non-proactive message (a user turn or a normal assistant reply) breaks the
 * run, so distinct help episodes the student actually engaged with stay
 * separate. Pure and order-preserving; never mutates the input.
 */
export function groupProactiveMessages(messages: ChatMessage[]): ChatRenderItem[] {
    const items: ChatRenderItem[] = [];
    let run: ChatMessage[] = [];

    const flushRun = (): void => {
        if (run.length === 0) {
            return;
        }
        if (run.length === 1) {
            items.push({ kind: 'single', message: run[0] });
        } else {
            items.push({
                kind: 'proactive-run',
                earlier: run.slice(0, -1),
                latest: run[run.length - 1],
            });
        }
        run = [];
    };

    for (const message of messages) {
        if (isProactive(message)) {
            run.push(message);
        } else {
            flushRun();
            items.push({ kind: 'single', message });
        }
    }
    flushRun();

    return items;
}
