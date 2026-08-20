import type { OidcLoginService } from './oidcLoginService';

/**
 * One meaning of "the user backed out", for every entry point that has to honour it: the Cancel button,
 * both logout paths, and a server change.
 *
 * Password attempts are held as an `AbortController` here rather than in the command module, because the
 * command module is not reachable from the activation-level commands that also have to cancel.
 */
export class AuthCancellationService {
    private pending?: AbortController;

    constructor(private readonly oidcLoginService: OidcLoginService) {}

    /**
     * Take ownership of a password attempt. Starting one retires any pending OIDC attempt, so
     * starting either kind of attempt retracts a pending attempt of the other kind.
     *
     * The OIDC retraction is fire-and-forget: `OidcLoginService.cancel()` marks the attempt invalidated
     * synchronously, before its first `await`, so that part is not lost by not awaiting here.
     */
    public register(controller: AbortController): void {
        this.pending?.abort();
        this.pending = controller;
        void this.oidcLoginService.cancel();
    }

    /** Give up ownership, but only while this is still the attempt in charge. */
    public release(controller: AbortController): void {
        if (this.pending === controller) {
            this.pending = undefined;
        }
    }

    /**
     * Announce that an OIDC attempt is starting. Retires any pending password attempt.
     * The OIDC-to-OIDC lifecycle is handled by `OidcLoginService.start()`.
     */
    public registerOidcStart(): void {
        this.pending?.abort();
        this.pending = undefined;
    }

    /**
     * Retract whatever sign-in is in progress.
     *
     * The password abort comes first and before any await on purpose: the webview provider does not await
     * command handlers, so a newer attempt can register during anything awaited here, and an abort issued
     * afterwards would hit the newer attempt instead of the one the user retracted.
     */
    public async cancelAll(): Promise<void> {
        this.pending?.abort();
        this.pending = undefined;

        await this.oidcLoginService.cancel();
    }
}
