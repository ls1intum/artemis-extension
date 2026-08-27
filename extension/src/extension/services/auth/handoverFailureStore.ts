import type { AttemptId } from '@shared/messageContracts';

export interface HandoverFailure {
    error: string;
    /**
     * The handover this belongs to. Monotone, so a view can recognise a replay
     * of one it already shows and leave its own state alone.
     */
    generation: number;
    /** Absent for OIDC, whose callback carries no attempt to correlate against. */
    attemptId?: AttemptId;
}

/**
 * Remembers that the post-commit handover failed, for as long as it matters.
 *
 * A live message is not enough on its own. The webview queues messages until it
 * is ready and `render()` throws the queue away
 * (`baseWebviewProvider.ts:_resetReadyState`), and a plain configuration change
 * is enough to trigger one. A failure announced into that window would vanish
 * while a login view is still on screen and the credential is still committed,
 * which is exactly the case that needs telling.
 *
 * So the outcome is kept here and replayed through the login view's init data,
 * which every new document asks for.
 *
 * Recording and clearing are both conditional on the generation. Without that a
 * navigation from an abandoned attempt could write its failure over a newer one,
 * or an old success could clear a failure the user has not seen yet.
 */
export class HandoverFailureStore {
    private _failure: HandoverFailure | undefined;
    private _generation = 0;

    /** Opens a handover. The returned generation is what may later speak for it. */
    public begin(): number {
        return ++this._generation;
    }

    /** Records a failure, unless a newer handover has already superseded this one. */
    public record(generation: number, error: string, attemptId?: AttemptId): HandoverFailure | undefined {
        if (generation !== this._generation) {
            return undefined;
        }
        this._failure = { error, generation, attemptId };
        return this._failure;
    }

    /** Clears the record if it belongs to this handover. A stale success clears nothing. */
    public clearFor(generation: number): void {
        if (generation === this._generation) {
            this._failure = undefined;
        }
    }

    /**
     * Drops the record outright. For the three things that make it meaningless
     * regardless of generation: the user deliberately starting another sign-in,
     * a second one through the browser, and the credential it refers to going
     * away.
     *
     * The generation moves on with it, so a handover that is still open cannot
     * come back later and record against it. Without that, a navigation still
     * running when the credential was cleared would write a "signed in, reload"
     * record with nothing signed in behind it.
     */
    public clear(): void {
        this._failure = undefined;
        this._generation++;
    }

    public get current(): HandoverFailure | undefined {
        return this._failure;
    }
}
