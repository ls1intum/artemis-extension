import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { ContextSwapTransition, ServerContext } from '@shared/types/serverContext';

import { readJsonAttributes } from '@extension/services/iris/chat/messageUtils';

export interface ContextSwap {
    transition: ContextSwapTransition;
    /** Absent for `removed`, which carries no entity fields. */
    context?: ServerContext;
}

const TRANSITIONS: ReadonlySet<string> = new Set(['added', 'removed', 'changed']);

/**
 * True for any CTXSWAP row, decodable or not. `hasContent` (spec 3.3) counts
 * marker rows as content, so this predicate must not depend on the attributes
 * parsing successfully.
 */
export function isContextSwap(message: IrisChatMessage): boolean {
    return message.sender === 'CTXSWAP';
}

/**
 * Senders Artemis persists as markers rather than chat: a point-out the
 * student's client carried out (`COMMAND`) and a compaction summary Iris reads
 * instead of older turns (`SUMMARY`). Host state keeps them (and
 * `contentState` counts them); the transcript, the display count and run
 * handling never see them. Deliberately a closed list: an unknown sender still
 * renders as an Iris answer, because hiding a future chat sender would lose
 * content and keep reconnect recovery waiting.
 */
const HIDDEN_MARKER_SENDERS: ReadonlySet<string> = new Set(['COMMAND', 'SUMMARY']);

export function isHiddenMarker(message: IrisChatMessage): boolean {
    return message.sender !== undefined && HIDDEN_MARKER_SENDERS.has(message.sender);
}

/** `undefined` when this is not a marker or its payload cannot be read. */
export function parseContextSwap(message: IrisChatMessage): ContextSwap | undefined {
    if (!isContextSwap(message)) { return undefined; }

    // The payload lives in a `json` CONTENT ITEM, not at the top level of the
    // message: IrisMessageContentResponseDTO maps IrisJsonMessageContent to
    // { type: "json", attributes: <raw> }. Reading message.attributes finds
    // nothing and silently drops every real marker.
    const item = (message.content ?? []).find((part) => part?.type === 'json' && part.attributes !== undefined);
    if (!item) { return undefined; }

    const attrs = readJsonAttributes(item.attributes);
    if (!attrs) { return undefined; }

    const transition = attrs['transition'];
    if (typeof transition !== 'string' || !TRANSITIONS.has(transition)) { return undefined; }
    if (transition === 'removed') { return { transition, context: undefined }; }

    const mode = attrs['entityMode'];
    const entityId = attrs['entityId'];
    if (typeof mode !== 'string' || typeof entityId !== 'number') { return undefined; }
    const name = attrs['name'];
    return {
        transition: transition as ContextSwapTransition,
        context: { mode, entityId, name: typeof name === 'string' ? name : undefined },
    };
}

function labelFor(context: ServerContext | undefined): string {
    if (!context) { return 'the course'; }
    if (context.name) { return context.name; }
    switch (context.mode) {
        case 'COURSE_CHAT': return 'the course';
        case 'LECTURE_CHAT': return `Lecture ${context.entityId}`;
        case 'PROGRAMMING_EXERCISE_CHAT':
        case 'TEXT_EXERCISE_CHAT': return `Exercise ${context.entityId}`;
        default: return `Context ${context.entityId}`;
    }
}

/** Mirrors Artemis `iris-context-switch-divider.component.html`. */
export function describeContextSwap(swap: ContextSwap): string {
    switch (swap.transition) {
        case 'added': return `Topic set to ${labelFor(swap.context)}`;
        case 'changed': return `Topic changed to ${labelFor(swap.context)}`;
        case 'removed': return 'Topic removed';
    }
}
