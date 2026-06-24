// extension/src/extension/services/struggle/signals/documentShadow.ts
/**
 * Before-text shadow per document URI. The A8 region mapping needs the
 * document state BEFORE each textChange (ranges refer to the pre-change
 * state); VS Code only hands us the post-change document, so the engine keeps
 * the previous getText() per URI: beforeText() returns the shadow, sync()
 * stores the post-change truth for the next event. Seeded at session start
 * from the open documents and on every onDidOpenTextDocument.
 */
export class DocumentShadowTracker {
    private readonly _texts = new Map<string, string>();

    seed(uriKey: string, text: string): void {
        this._texts.set(uriKey, text);
    }

    /** Document text before the current change event; undefined if never seen
     *  (the change is then EXCLUDED from A8, matching the offline pipeline's
     *  missing_snapshot semantics). */
    beforeText(uriKey: string): string | undefined {
        return this._texts.get(uriKey);
    }

    /** Store the post-change document text (event.document.getText()). */
    sync(uriKey: string, text: string): void {
        this._texts.set(uriKey, text);
    }

    drop(uriKey: string): void {
        this._texts.delete(uriKey);
    }

    reset(): void {
        this._texts.clear();
    }
}
