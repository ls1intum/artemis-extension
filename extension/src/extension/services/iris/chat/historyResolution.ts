/**
 * Conclusive proof that an in-flight Iris answer completed while we were
 * disconnected: the fetched session history contains a non-intermediate
 * assistant message newer than the send baseline. Persisted history alone
 * cannot prove a run ended (a missed FAILED frame produces no message), so the
 * caller must only treat this `true` as resolution, never fetch-success.
 */
export function historyResolvesRun(
    // `role` is widened to a plain string: the conversation transcript also
    // carries `contextSwap` rows, and only `assistant` is ever matched here.
    messages: ReadonlyArray<{ id?: number; role: string; final?: boolean }>,
    baselineId: number,
): boolean {
    return messages.some(
        (m) => m.role === 'assistant' && m.final !== false && m.id !== undefined && m.id > baselineId,
    );
}
