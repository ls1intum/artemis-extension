import type { IrisChatMessageContent } from '@extension/types';

/**
 * Normalise an Iris message `content` field into a plain string suitable
 * for the chat surface and persistence. Artemis ships the field as either
 * a string, an array of `{ textContent }` parts, or a missing/null value.
 *
 * Returns `''` for `null`/`undefined` rather than falling through to
 * `JSON.stringify`, which returns the *value* `undefined` (not the string
 * `'undefined'`) for an `undefined` input. Callers read `.length` on the result.
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
            // Never `item.toString()`: for a plain object that yields the literal
            // "[object Object]" in the transcript. An unrecognised part has no
            // renderable text, so it contributes nothing.
            return '';
        }).filter((part) => part.length > 0).join('\n');
    }
    if (typeof content === 'string') {
        return content;
    }
    return JSON.stringify(content) ?? '';
}
