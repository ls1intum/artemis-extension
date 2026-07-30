import type { IrisChatMessage } from '@shared/types/apiResponses';
import type { ContextSwapTransition, ServerContext } from '@shared/types/serverContext';

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

/** `undefined` when this is not a marker or its payload cannot be read. */
export function parseContextSwap(message: IrisChatMessage): ContextSwap | undefined {
    if (!isContextSwap(message)) { return undefined; }

    // The payload lives in a `json` CONTENT ITEM, not at the top level of the
    // message: IrisMessageContentResponseDTO maps IrisJsonMessageContent to
    // { type: "json", attributes: <raw> }. Reading message.attributes finds
    // nothing and silently drops every real marker.
    const item = (message.content ?? []).find((part) => part?.type === 'json' && part.attributes !== undefined);
    if (!item) { return undefined; }

    // @JsonRawValue serialises it as an inline object. The string branch is
    // defensive only, for a server that ever drops that annotation.
    const raw = item.attributes;
    let attrs: Record<string, unknown> | undefined;
    if (typeof raw === 'string') {
        try {
            const parsed: unknown = JSON.parse(raw);
            attrs = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
        } catch {
            attrs = undefined;
        }
    } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        attrs = raw as Record<string, unknown>;
    }
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
    if (!context) { return 'den Kurs'; }
    if (context.name) { return context.name; }
    switch (context.mode) {
        case 'COURSE_CHAT': return 'den Kurs';
        case 'LECTURE_CHAT': return `Vorlesung ${context.entityId}`;
        case 'PROGRAMMING_EXERCISE_CHAT':
        case 'TEXT_EXERCISE_CHAT': return `Aufgabe ${context.entityId}`;
        default: return `Kontext ${context.entityId}`;
    }
}

/** Mirrors Artemis `iris-context-switch-divider.component.html`. */
export function describeContextSwap(swap: ContextSwap): string {
    switch (swap.transition) {
        case 'added': return `Thema gesetzt auf ${labelFor(swap.context)}`;
        case 'changed': return `Thema gewechselt zu ${labelFor(swap.context)}`;
        case 'removed': return 'Thema entfernt';
    }
}
