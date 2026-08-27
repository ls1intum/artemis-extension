import type * as vscode from 'vscode';

/**
 * Domains the user has agreed to open external links for without a prompt.
 *
 * The list lives in `globalState` under one key, read by the link handler and
 * written by both the "Trust this domain" answer and the clear command. Going
 * through here keeps the key spelled once: a typo in any copy would silently
 * produce a second, empty list and re-prompt for domains the user had already
 * trusted.
 */
const TRUSTED_DOMAINS_KEY = 'artemis.trustedDomains';

export function getTrustedDomains(context: vscode.ExtensionContext): string[] {
    const stored = context.globalState.get<string[]>(TRUSTED_DOMAINS_KEY, []);
    // globalState is user-writable JSON, so a non-array survives a downgrade or
    // a hand-edited state file and must not reach `.includes`.
    return Array.isArray(stored) ? stored : [];
}

export async function trustDomain(context: vscode.ExtensionContext, domain: string): Promise<void> {
    await context.globalState.update(TRUSTED_DOMAINS_KEY, [...getTrustedDomains(context), domain]);
}

export async function clearTrustedDomains(context: vscode.ExtensionContext): Promise<void> {
    await context.globalState.update(TRUSTED_DOMAINS_KEY, []);
}
