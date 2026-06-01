import type { IrisChatMessageContent } from '@extension/types';

/**
 * Normalise an Iris message `content` field into a plain string suitable
 * for the chat surface and persistence. Artemis ships the field as either
 * a string, an array of `{ textContent }` parts, or a missing/null value.
 *
 * Returns `''` for `null`/`undefined`. The previous implementation called
 * `JSON.stringify` unconditionally, which returns the *value* `undefined`
 * (not the string `'undefined'`) for an `undefined` input. Callers then
 * read `.length` on the result and crashed. See #193.
 */
export function extractIrisMessageContent(content: unknown): string {
    if (content === null || content === undefined) {
        return '';
    }
    if (Array.isArray(content) && content.length > 0) {
        return content.map((item: IrisChatMessageContent) => {
            if (item.textContent) {
                return item.textContent;
            }
            return item.toString?.() ?? String(item);
        }).join('\n');
    }
    if (typeof content === 'string') {
        return content;
    }
    return JSON.stringify(content) ?? '';
}
