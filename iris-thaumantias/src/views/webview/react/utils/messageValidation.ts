export interface TypedMessage {
    type: string;
    payload?: unknown;
}

export function isTypedMessage(data: unknown): data is TypedMessage {
    return typeof data === 'object' && data !== null && 'type' in data;
}
