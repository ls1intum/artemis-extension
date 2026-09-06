/**
 * Pure in-memory file-text reconstruction for the golden-replay harness.
 *
 * Recorded `textDocumentOpen` events carry no text, so the harness must
 * rebuild each file's text from the startup `fileSnapshot` plus the applied
 * `textChange` deltas. This class holds the per-URI current text and supplies
 * it to the struggle engine's onDidChangeTextDocument handler (whose own
 * document shadow derives before/after text for its feature computations) and,
 * in causal mode, to the paste-detection heuristic that decides N1 boundaries.
 *
 * The delta-application logic is ported from `scripts/roundtrip-recording.ts`
 * (`replayUri`, the `content.slice(0, off) + text + content.slice(off + len)`
 * loop): changes are applied in ARRAY ORDER, never sorted. VS Code delivers
 * `contentChanges` pre-sorted (descending position), so array-order application
 * reproduces exactly what the live engine/recorder observed. The Python
 * reference sorts descending, which is equivalent for valid data, but we
 * mirror the live VS Code behaviour.
 *
 * Unlike the script (which collects errors and continues so it can report on
 * a whole recording), this class THROWS on a bad offset/range: the harness
 * wants corruption surfaced immediately rather than silently skipped.
 */
export class FileTextState {
    private readonly _texts = new Map<string, string>();

    /** Initial content for a URI (the recorded fileSnapshot text). */
    seedSnapshot(uriKey: string, text: string): void {
        this._texts.set(uriKey, text);
    }

    /**
     * Apply one textChange event's `changes[]` to the current text, in array
     * order. Each change replaces `[rangeOffset, rangeOffset + rangeLength)`
     * with `text`. Throws if the URI was never seeded or a change is out of
     * bounds.
     */
    applyChanges(
        uriKey: string,
        changes: { rangeOffset: number; rangeLength: number; text: string }[],
    ): void {
        let content = this._texts.get(uriKey);
        if (content === undefined) {
            throw new Error(
                `cannot apply changes to URI "${uriKey}": it was never seeded with a snapshot`,
            );
        }
        for (let i = 0; i < changes.length; i++) {
            const { rangeOffset: off, rangeLength: len, text } = changes[i];
            if (off < 0) {
                throw new Error(
                    `textChange #${i} for URI "${uriKey}" has rangeOffset<0: ${off}`,
                );
            }
            if (off + len > content.length) {
                throw new Error(
                    `textChange #${i} for URI "${uriKey}" range ${off}+${len}=${off + len} ` +
                    `exceeds content length ${content.length}`,
                );
            }
            content = content.slice(0, off) + text + content.slice(off + len);
        }
        this._texts.set(uriKey, content);
    }

    /** Current reconstructed text, or undefined if the URI was never seeded. */
    getText(uriKey: string): string | undefined {
        return this._texts.get(uriKey);
    }

    /** True if the URI has been seeded. */
    has(uriKey: string): boolean {
        return this._texts.has(uriKey);
    }
}
