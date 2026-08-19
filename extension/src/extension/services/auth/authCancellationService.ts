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

    /** Take ownership of an attempt. Starting one retires any attempt still running, so at most one is live. */
    public register(controller: AbortController): void {
        this.pending?.abort();
        this.pending = controller;
    }

    /** Give up ownership, but only while this is still the attempt in charge. */
    public release(controller: AbortController): void {
        if (this.pending === controller) {
            this.pending = undefined;
        }
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
