export type IrisFrameClass =
    | { kind: 'message'; proactive: boolean }
    | { kind: 'status' }
    | { kind: 'ignore' };

const PROACTIVE_ORIGIN = 'PROACTIVE_STRUGGLE';

/** Pure dispatch decision for an inbound per-session Iris chat frame (open record). */
export function classifyIrisFrame(data: unknown): IrisFrameClass {
    if (data === null || typeof data !== 'object') {
        return { kind: 'ignore' };
    }
    const frame = data as { type?: unknown; message?: unknown };
    if (frame.type === 'MESSAGE' && frame.message) {
        const origin = (frame.message as { origin?: unknown }).origin;
        return { kind: 'message', proactive: origin === PROACTIVE_ORIGIN };
    }
    if (frame.type === 'STATUS') {
        return { kind: 'status' };
    }
    return { kind: 'ignore' };
}
