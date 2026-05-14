// Lightweight runtime validators for the permissive `[key: string]: unknown`
// API response interfaces. Catches the easy "server returned null / array /
// primitive where we expected an object" class of failures before the data
// flows into UI components. The validators throw `MalformedResponseError`
// so callers can use a single `instanceof` check to distinguish schema
// failures from transport/auth failures (see `exerciseDataLoader.ts`).

import { MalformedResponseError } from './errors';

function failed(label: string, detail: string): MalformedResponseError {
    return new MalformedResponseError(`Malformed ${label} response: ${detail}`, 200, detail);
}

/** Assert that `data` is a plain (non-array) object. */
export function expectObject(label: string, data: unknown): Record<string, unknown> {
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
        throw failed(label, `expected object, got ${describe(data)}`);
    }
    return data as Record<string, unknown>;
}

/** Assert that `data` is an array. Optionally validates each element. */
export function expectArray<T = unknown>(
    label: string,
    data: unknown,
    elementValidator?: (item: unknown, index: number) => T,
): T[] {
    if (!Array.isArray(data)) {
        throw failed(label, `expected array, got ${describe(data)}`);
    }
    if (!elementValidator) {
        return data as T[];
    }
    return data.map((item, index) => elementValidator(item, index));
}

/**
 * Parse an API JSON body that maps to a permissive interface (most of the
 * `[key: string]: unknown` types in `shared/types/apiResponses.ts`). Only
 * the listed `required` keys are checked for presence and primitive type;
 * everything else is trusted as the interface declares it.
 */
export function parseApiObject<T>(
    label: string,
    data: unknown,
    required: ReadonlyArray<{ key: string; type: 'string' | 'number' }> = [],
): T {
    const obj = expectObject(label, data);
    for (const { key, type } of required) {
        const value = obj[key];
        if (typeof value !== type) {
            throw failed(label, `missing or non-${type} field "${key}"`);
        }
    }
    return obj as T;
}

function describe(value: unknown): string {
    if (value === null) { return 'null'; }
    if (Array.isArray(value)) { return 'array'; }
    return typeof value;
}
