export function extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * Strips embedded credentials from any https URL appearing in a string.
 *
 * Every git remote the extension installs carries a VCS access token in its
 * URL, and `execFile` errors quote the command that failed, so the raw text of
 * a git failure is a credential leak into logs and notifications. Redact before
 * the string reaches the logger: it prints the message and the stack.
 */
function redactUrlCredentials(text: string): string {
    return text
        .replace(/(\bhttps?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1***:***@')
        .replace(/(\bhttps?:\/\/)[^/\s@]+@/gi, '$1***@');
}

/** `extractErrorMessage` with the credential redaction every git error needs. */
export function extractRedactedErrorMessage(error: unknown): string {
    return redactUrlCredentials(extractErrorMessage(error));
}
