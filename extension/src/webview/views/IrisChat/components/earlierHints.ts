import type { ChatRenderItem } from './groupProactiveMessages';

/**
 * For a render item, its episodeId if it currently renders as a CLOSED proactive fold line,
 * else undefined. Non-proactive singles, id-less proactive singles, and OPEN (live, unfolded)
 * episodes all return undefined. The caller supplies this because closed-ness depends on runtime
 * store state (foldStates / liveEpisodeIds), which the pure grouping below must not read.
 */
export type ClosedResolver = (item: ChatRenderItem) => string | undefined;

/**
 * A row after the second grouping pass: either an item to render as-is, or a run of consecutive
 * closed episodes collapsed behind a single "N earlier hints" line. `key` is the first episodeId
 * of the run (stable as newer episodes join the tail, so the expand state survives).
 */
export type EarlierHintsRow =
    | { kind: 'item'; item: ChatRenderItem }
    | { kind: 'earlier-hints'; key: string; items: ChatRenderItem[] };

/** A lone closed episode stays a plain fold line; only runs of this length or longer collapse. */
const MIN_RUN = 2;

/**
 * Collapses maximal runs of >= {@link MIN_RUN} consecutive closed proactive episodes into a single
 * `earlier-hints` row. Anything the resolver does not mark closed (chat turns, on-demand replies,
 * the live/open episode) passes through untouched and breaks the run. Pure and order-stable.
 */
export function groupEarlierHints(items: ChatRenderItem[], closedEpisodeId: ClosedResolver): EarlierHintsRow[] {
    const rows: EarlierHintsRow[] = [];
    let run: ChatRenderItem[] = [];
    let runKey: string | undefined;

    const flush = (): void => {
        if (run.length >= MIN_RUN && runKey !== undefined) {
            rows.push({ kind: 'earlier-hints', key: runKey, items: run });
        } else {
            for (const item of run) { rows.push({ kind: 'item', item }); }
        }
        run = [];
        runKey = undefined;
    };

    for (const item of items) {
        const episodeId = closedEpisodeId(item);
        if (episodeId !== undefined) {
            if (run.length === 0) { runKey = episodeId; }
            run.push(item);
        } else {
            flush();
            rows.push({ kind: 'item', item });
        }
    }
    flush();

    return rows;
}
