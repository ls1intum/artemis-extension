/**
 * Pure (vscode-free) one-shot rebase of a server anchor line, from the working-copy SNAPSHOT the
 * client sent at trigger time to the current in-memory buffer at delivery (~10s later). The server
 * anchored the line against exactly those snapshot bytes; by the time the decision returns the
 * student has kept typing, so the raw line can be stale. Kept dependency-free so the vscode-free
 * orchestrator can call it at the single anchor choke point.
 *
 * Strategy: a common-prefix / common-suffix split (a cheap, deterministic diff). An anchor in the
 * unchanged head keeps its line; in the unchanged tail it shifts by the net line delta; inside the
 * changed band it re-finds the exact baseline text nearest its expected position. No match means the
 * line was rewritten or deleted -> `undefined`, and the caller suppresses the cue (the bubble stays).
 */
export function rebaseAnchorLine(baseline: string, current: string, anchorLine: number): number | undefined {
    const baseLines = baseline.split('\n');
    const curLines = current.split('\n');
    const idx = anchorLine - 1; // 0-based index into the baseline snapshot
    if (idx < 0 || idx >= baseLines.length) {
        return undefined; // the anchor line is not in the snapshot we sent: cannot rebase
    }

    // Longest common run of leading lines.
    let prefix = 0;
    const maxCommon = Math.min(baseLines.length, curLines.length);
    while (prefix < maxCommon && baseLines[prefix] === curLines[prefix]) {
        prefix++;
    }
    // Longest common run of trailing lines, not overlapping the prefix on either side.
    let suffix = 0;
    while (
        suffix < baseLines.length - prefix
        && suffix < curLines.length - prefix
        && baseLines[baseLines.length - 1 - suffix] === curLines[curLines.length - 1 - suffix]
    ) {
        suffix++;
    }

    // Anchor in the unchanged head: line unchanged.
    if (idx < prefix) {
        return anchorLine;
    }
    const delta = curLines.length - baseLines.length;
    // Anchor in the unchanged tail: shift by the net line delta.
    if (idx >= baseLines.length - suffix) {
        return anchorLine + delta;
    }

    // Anchor inside the changed band: re-find its exact text in the current changed band. Restrict
    // to the band [prefix, curLines.length - suffix) so a line duplicated in the common head/tail
    // (e.g. a guard `return 0;`) cannot steal the match. Pick the occurrence nearest where a pure
    // shift would land; tie-break to the lowest index for determinism.
    const target = baseLines[idx];
    const expected = idx + delta;
    const bandEnd = curLines.length - suffix; // exclusive
    let best: number | undefined;
    let bestDist = Infinity;
    for (let i = prefix; i < bandEnd; i++) {
        if (curLines[i] === target) {
            const dist = Math.abs(i - expected);
            if (dist < bestDist) {
                best = i;
                bestDist = dist;
            }
        }
    }
    return best === undefined ? undefined : best + 1;
}
