import type { ChatMessage } from '@webview/views/IrisChat/types';

/** A proactive episode's terminal reaction (mirrors {@link ChatMessage.proactiveOutcome}). */
export type EpisodeOutcome = NonNullable<ChatMessage['proactiveOutcome']>;

/** Display metadata for a folded episode's outcome: a leading glyph, a short word, and a colour tone. */
export interface OutcomeMeta {
    glyph: string;
    word: string;
    tone: 'success' | 'muted' | 'neutral';
}

/**
 * Row-derived fallback outcome for an episode: the LAST explicit reaction across its messages
 * (last-wins, since the terminal reaction is the most recent). Used when no host-threaded
 * `foldState.outcome` is available (reloaded history has message-level outcomes but no fold frame).
 */
export function rowOutcome(messages: ChatMessage[]): EpisodeOutcome | undefined {
    let out: EpisodeOutcome | undefined;
    for (const m of messages) {
        if (m.proactiveOutcome) {
            out = m.proactiveOutcome;
        }
    }
    return out;
}

/** Glyph + word + tone for a folded episode's outcome (undefined = an old/neutral hint). */
export function outcomeMeta(outcome: EpisodeOutcome | undefined): OutcomeMeta {
    switch (outcome) {
        case 'RECOVERED': return { glyph: '✓', word: 'Resolved', tone: 'success' };
        case 'DISMISSED': return { glyph: '✕', word: 'Dismissed', tone: 'muted' };
        case 'ABANDONED': return { glyph: '⧗', word: 'Timed out', tone: 'muted' };
        default: return { glyph: '·', word: 'Earlier hint', tone: 'neutral' };
    }
}

const MAX_TOPIC = 48;

/**
 * A clean one-line topic from a hint body: light markdown stripped, whitespace collapsed, cut at a
 * word boundary at most {@link MAX_TOPIC} chars (with an ellipsis). Best-effort — the link regex does
 * not handle a literal `)` inside a URL, but it degrades to leaving the raw text rather than crashing.
 */
export function cleanTopic(raw: string): string {
    const flat = raw
        .replace(/```[\s\S]*?```/g, ' ')          // fenced code blocks
        .replace(/`([^`]+)`/g, '$1')               // inline code
        .replace(/\*\*([^*]+)\*\*/g, '$1')         // bold
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')   // links -> link text (best-effort)
        .replace(/^\s*[#>\-*]+\s+/, '')             // only a LEADING heading / blockquote / list marker
        .replace(/\s+/g, ' ')
        .trim();
    if (!flat) { return 'Proactive hint'; }
    if (flat.length <= MAX_TOPIC) { return flat; }
    const cut = flat.slice(0, MAX_TOPIC);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The label for a folded episode: a server-provided praise label wins (progress-close terminals);
 * otherwise a clean topic derived from the FIRST message (the initial hint, never a later stale-check).
 */
export function episodeTopic(messages: ChatMessage[], praiseLabel?: string): string {
    if (praiseLabel && praiseLabel.trim()) {
        return praiseLabel.trim();
    }
    return cleanTopic(messages[0]?.content ?? '');
}
