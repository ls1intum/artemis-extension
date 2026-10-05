import type { IrisChatMessageContent } from '@extension/types';

const QUIZ_QUESTION_PLACEHOLDER = '*Iris created a quiz question. Open this chat in Artemis to answer it.*';

/**
 * Decodes the `attributes` of a `json` content part. `@JsonRawValue` makes
 * Artemis serialise it as an inline object; the string branch is defensive
 * only, for a server that ever drops that annotation. Anything that is not a
 * JSON object is `undefined`.
 */
export function readJsonAttributes(raw: unknown): Record<string, unknown> | undefined {
    let value = raw;
    if (typeof raw === 'string') {
        try {
            value = JSON.parse(raw);
        } catch {
            return undefined;
        }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * The extension has no quiz component, so a quiz Iris generated (`mcq`, or
 * `mcq-set` with `questions`, validated by Artemis) becomes one line that sends
 * the student to the web client, which can render and grade it.
 */
function quizPlaceholder(attrs: Record<string, unknown> | undefined): string | undefined {
    if (attrs?.['type'] === 'mcq') {
        return QUIZ_QUESTION_PLACEHOLDER;
    }
    if (attrs?.['type'] === 'mcq-set') {
        const questions = attrs['questions'];
        return Array.isArray(questions) && questions.length >= 2
            ? `*Iris created ${questions.length} quiz questions. Open this chat in Artemis to answer them.*`
            : QUIZ_QUESTION_PLACEHOLDER;
    }
    return undefined;
}

/**
 * Normalise an Iris message `content` field into a plain string suitable
 * for the chat surface and persistence. Artemis ships the field as either
 * a string, an array of parts, or a missing/null value. A part is text
 * (`textContent`) or typed `json`: a quiz part becomes a placeholder line,
 * any other `json` part contributes nothing.
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
            if (item.type === 'json') {
                return quizPlaceholder(readJsonAttributes(item.attributes)) ?? '';
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
