/**
 * Rotation text pool for the proactive nudge banner. English-only fixed pool of 4,
 * picked at random per appearance with no immediate repeat of the previous title.
 */

export interface NudgeText { title: string; sub: string; }

/**
 * Sentinel `episodeId` for the developer-only "mock proactivity" banner. The banner's action
 * buttons route globally back into the orchestrator (`handleBannerAction` -> recordOutcome /
 * dismissEpisode); a purely-visual mock must never mutate real backoff or episode state, so both
 * the telemetry handler and the chat-focus subscription no-op when they see this id.
 */
export const MOCK_NUDGE_EPISODE_ID = '__mock_nudge__';

export const NUDGE_TEXTS: readonly NudgeText[] = [
    { title: 'Hit a wall?', sub: "I've got a small nudge ready." },
    { title: 'Stuck here?', sub: 'Want a quick pointer?' },
    { title: 'Need a hand?', sub: 'A nudge is ready when you are.' },
    { title: "Let's get you unstuck", sub: 'One hint, no spoilers.' },
];

export function pickNudgeText(prevTitle?: string, rand: () => number = Math.random): NudgeText {
    const pool = prevTitle ? NUDGE_TEXTS.filter(t => t.title !== prevTitle) : NUDGE_TEXTS;
    const src = pool.length ? pool : NUDGE_TEXTS;
    return src[Math.floor(rand() * src.length) % src.length];
}
