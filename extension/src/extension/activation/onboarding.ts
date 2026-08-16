/** Walkthrough id as contributed in `package.json` under `contributes.walkthroughs`. */
const WALKTHROUGH_ID = 'artemisGetStarted';

/** `globalState` key recording that the first-run decision has been made. */
export const WALKTHROUGH_SHOWN_KEY = 'artemis.walkthrough.shown';

/**
 * Outcome of the startup credential read. `unknown` means the read itself failed
 * (SecretStorage error), which is different from "no credentials" and must not be
 * treated as a first-time user.
 */
export type StartupAuthState = 'has-credentials' | 'no-credentials' | 'unknown';

export interface OnboardingDeps {
    authState: StartupAuthState;
    /** `contributes.walkthroughs` from THIS build's packaged manifest. */
    contributedWalkthroughs: unknown;
    /** `publisher.name`, e.g. `aet-tum.iris-thaumantias`. */
    extensionId: string;
    isTheia: boolean;
    wasShown: () => boolean;
    // `PromiseLike`, not `Promise`: these are backed by VS Code APIs that return
    // `Thenable`, and this module deliberately imports nothing from `vscode`.
    markShown: () => PromiseLike<void>;
    openWalkthrough: (walkthroughId: string) => PromiseLike<unknown>;
}

function contributesGetStarted(walkthroughs: unknown): boolean {
    return Array.isArray(walkthroughs)
        && walkthroughs.some(w => (w as { id?: unknown } | null)?.id === WALKTHROUGH_ID);
}

/**
 * Opens the Get Started walkthrough once per installation.
 *
 * The guards split into two kinds, and the split is the point of the ordering below.
 * A guard that made a real decision about this installation records it, so the tour
 * never reappears. A guard that hit a condition which can change underneath us leaves
 * the flag alone, so a later activation gets another go:
 *
 *   - The walkthrough is not in this manifest: the Open VSX artifact strips it, and
 *     that artifact installs into ordinary desktop VS Code too, where `isTheia` is
 *     false. Asking VS Code to open an id that does not exist is the bug this
 *     prevents. A student may later switch to the Marketplace build, which has it.
 *   - The credential read threw: a transient SecretStorage failure must not silence
 *     onboarding forever.
 *
 * `authState` is a deliberately blunt instrument. It comes from a token EXISTING, not
 * from a token being valid, so a logged-out returning user still counts as new and a
 * fresh install holding a stale token does not. For deciding whether to show a tour
 * that is the right trade: never interrupt someone who looks settled.
 */
export async function maybeOpenGetStartedWalkthrough(deps: OnboardingDeps): Promise<void> {
    if (deps.wasShown()) { return; }
    if (!contributesGetStarted(deps.contributedWalkthroughs)) { return; }
    if (deps.authState === 'unknown') { return; }

    await deps.markShown();

    if (deps.isTheia || deps.authState === 'has-credentials') { return; }

    await deps.openWalkthrough(`${deps.extensionId}#${WALKTHROUGH_ID}`);
}
