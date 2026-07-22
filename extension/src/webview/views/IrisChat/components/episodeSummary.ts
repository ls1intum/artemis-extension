import type { LucideIcon } from 'lucide-react';
import CircleCheck from 'lucide-react/dist/esm/icons/circle-check';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';
import X from 'lucide-react/dist/esm/icons/x';

import { stripMarkdown } from '@shared/stripMarkdown';

import type { ChatMessage } from '@webview/views/IrisChat/types';

/** A proactive episode's terminal reaction (mirrors {@link ChatMessage.proactiveOutcome}). */
export type EpisodeOutcome = NonNullable<ChatMessage['proactiveOutcome']>;

/**
 * Display metadata for a folded episode's outcome: a Lucide icon (the only thing shown while collapsed),
 * a short word (rendered as the icon's aria-label, and as visible text once the episode is expanded), and
 * a colour tone.
 */
export interface OutcomeMeta {
    Icon: LucideIcon;
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

/** Icon + word + tone for a folded episode's outcome (undefined = an old/neutral hint). */
export function outcomeMeta(outcome: EpisodeOutcome | undefined): OutcomeMeta {
    switch (outcome) {
        case 'RECOVERED': return { Icon: CircleCheck, word: 'Resolved', tone: 'success' };
        case 'DISMISSED': return { Icon: X, word: 'Dismissed', tone: 'muted' };
        case 'ABANDONED': return { Icon: Hourglass, word: 'Timed out', tone: 'muted' };
        default: return { Icon: Lightbulb, word: 'Earlier hint', tone: 'neutral' };
    }
}

const MAX_TOPIC = 48;

/**
 * A clean one-line topic from a hint body: markdown stripped via {@link stripMarkdown}, whitespace
 * collapsed, cut at a word boundary at most {@link MAX_TOPIC} chars (with an ellipsis). Best-effort:
 * the link regex does not handle a literal `)` inside a URL, but it degrades to leaving the raw text
 * rather than crashing.
 */
export function cleanTopic(raw: string): string {
    const flat = stripMarkdown(raw)
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
