/**
 * Narrow an alert union (AlertRecord / DecisionAlert / recorded AlertEvent) to
 * its edit variant in tests that only exercise the edit-path decision. Throws on
 * a discrete add-on alert so a regression that mislabels an alert fails loudly
 * instead of reading `undefined`.
 */
export function asEditAlert<T extends { kind: 'edit' | 'discrete' }>(
    a: T | null | undefined,
): Extract<T, { kind: 'edit' }> {
    if (!a || a.kind !== 'edit') {
        throw new Error(`expected an edit alert, got ${a ? a.kind : 'null'}`);
    }
    return a as Extract<T, { kind: 'edit' }>;
}
