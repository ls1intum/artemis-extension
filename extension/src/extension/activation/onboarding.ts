/** Walkthrough id as contributed in `package.json` under `contributes.walkthroughs`. */
export const WALKTHROUGH_ID = 'artemisGetStarted';

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

/** Step ids of the Get Started walkthrough, in manifest order. */
export const WALKTHROUGH_STEPS = ['chooseServer', 'signIn', 'exerciseFolder', 'meetIris', 'preferences'] as const;
export type WalkthroughStep = typeof WALKTHROUGH_STEPS[number];

/**
 * The step whose button ran a command. Only the walkthrough's own links pass
 * `{ walkthroughStep }`, so the same command run from the palette or a view returns
 * `undefined` and never touches the walkthrough.
 */
export function parseWalkthroughStep(arg: unknown): WalkthroughStep | undefined {
    if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) { return undefined; }
    const step = (arg as { walkthroughStep?: unknown }).walkthroughStep;
    return WALKTHROUGH_STEPS.find(known => known === step);
}

export interface WalkthroughNavigatorDeps {
    extensionId: string;
    isSignedIn: () => PromiseLike<boolean>;
    /** `welcome.markStepComplete` with a fully qualified step id. */
    markStepComplete: (stepId: string) => PromiseLike<unknown>;
    /** `workbench.action.openWalkthrough` with a `{ category, step }` argument. */
    openWalkthrough: (target: { category: string; step: string }) => PromiseLike<unknown>;
    onError: (error: unknown) => void;
}

/**
 * Ticks a walkthrough step whose button did its job and selects the next step. VS Code
 * only ticks a step on its completion events and never selects the next one by itself.
 * The explicit tick covers what the events miss: a context key that was already true
 * when VS Code registered the step never ticks it, and `onSettingChanged` misses a
 * setting chosen again unchanged.
 */
export class WalkthroughNavigator {
    /** Set by the sign-in button, consumed by the next successful login in this window. */
    private signInPending = false;

    constructor(private readonly deps: WalkthroughNavigatorDeps) {}

    /** Never rejects: a walkthrough that cannot be updated must not fail the command that ran. */
    public async stepDone(step: WalkthroughStep): Promise<void> {
        const category = `${this.deps.extensionId}#${WALKTHROUGH_ID}`;
        try {
            await this.deps.markStepComplete(`${category}#${step}`);
        } catch (error: unknown) {
            this.deps.onError(error);
        }

        let next = WALKTHROUGH_STEPS[WALKTHROUGH_STEPS.indexOf(step) + 1];
        // VS Code selects the FIRST step when asked for one its `when` clause hides,
        // and Meet Iris is hidden until the student is signed in.
        if (next === 'meetIris' && !(await this.isSignedIn())) {
            next = 'preferences';
        }
        if (next === undefined) { return; }
        try {
            await this.deps.openWalkthrough({ category, step: next });
        } catch (error: unknown) {
            this.deps.onError(error);
        }
    }

    /**
     * For the sign-in button. Signed in already: the step is done now. Otherwise it is
     * done after the next successful login. Returns whether the login still has to be shown.
     */
    public async signInRequested(): Promise<boolean> {
        if (await this.isSignedIn()) {
            await this.stepDone('signIn');
            return false;
        }
        this.signInPending = true;
        return true;
    }

    /** A failed or cancelled login leaves the sign-in pending for the next attempt. */
    public async signedIn(): Promise<void> {
        if (!this.signInPending) { return; }
        this.signInPending = false;
        await this.stepDone('signIn');
    }

    /** A failing credential read counts as signed out: the login is then shown, never skipped. */
    private async isSignedIn(): Promise<boolean> {
        try {
            return await this.deps.isSignedIn();
        } catch (error: unknown) {
            this.deps.onError(error);
            return false;
        }
    }
}
