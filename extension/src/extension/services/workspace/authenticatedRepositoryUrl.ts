/**
 * Build the clone/remote URL that carries a VCS access token.
 *
 * Pure on purpose. The old helper fetched the token and built the URL in one
 * step, which is fine for cloning, where get-or-create is right, and wrong for
 * renewal, where a get would return the very token that stopped working.
 * Keeping construction separate lets each caller own how it obtained the token.
 *
 * Returns undefined when Artemis handed us something that is not a URL, which
 * the caller must report rather than write into a git remote.
 */
export function buildAuthenticatedRepositoryUrl(
    repositoryUri: string,
    login: string,
    token: string,
): string | undefined {
    try {
        const url = new URL(repositoryUri);
        url.username = login;
        url.password = token;
        return url.toString();
    } catch {
        return undefined;
    }
}
