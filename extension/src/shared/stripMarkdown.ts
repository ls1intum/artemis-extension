/** Private-use sentinel wrapping a protected inline-code index; cannot occur in hint text. */
const CODE_SENTINEL = '\uE000';

/**
 * Strip markdown *markers* from a string, keeping the visible text: fenced blocks, inline code,
 * images, links, bold, italic, and strikethrough. Best-effort and inline-oriented.
 *
 * Guarantees that matter for the truncated hint previews (folded episode one-liner, in-editor
 * hover). It is linear-time: every pass uses character classes (never `.+?`, and the link/image
 * text and URL classes cannot scan across another `[` or `(`), so no input can ReDoS. It leaves
 * inline-code contents opaque, so a `__dunder__` or `*x*` inside code is not re-stripped. Emphasis
 * is matched-pair only with Unicode word-boundary guards, so a lone `*` in prose (`a * b`), an
 * intra-word `_` (`a_b`), a `__`/`**` run inside an identifier (`foo__bar__baz`), and a
 * backslash-escaped delimiter (`\*x\*`) all survive. It does not collapse whitespace or strip a
 * leading structural marker (heading / blockquote / list); callers that need those own them. The
 * Iris chat keeps and renders the full markdown message; only the plain previews strip.
 */
export function stripMarkdown(text: string): string {
    // Drop any literal sentinel already in the input so our index markers cannot collide with it.
    let out = text.replace(/\uE000/g, '');

    // Fenced code blocks: drop entirely.
    out = out.replace(/```[\s\S]*?```/g, ' ');

    // Protect inline-code spans so their contents stay opaque to the passes below.
    const codes: string[] = [];
    out = out.replace(/`([^`\n]+)`/g, (_m, inner: string) => {
        codes.push(inner);
        return `${CODE_SENTINEL}${codes.length - 1}${CODE_SENTINEL}`;
    });

    // Images before links (an image is a link with a leading `!`). Link text is bounded by `[` and
    // the destination by `(`, so a failed candidate cannot scan across a later opener: linear even
    // on malformed input.
    // Emphasis passes use character classes (never `.+?`), exclude the same delimiter char from the
    // boundary guards (so a `__`/`**` run is not split by the single-delimiter pass), and refuse a
    // delimiter preceded by a backslash (so an escaped `\*` is left literal).
    out = out
        .replace(/!\[([^[\]\n]*)\]\([^()\n]*\)/g, '$1')                                          // images -> alt
        .replace(/\[([^[\]\n]+)\]\([^()\n]*\)/g, '$1')                                           // links -> text
        .replace(/(?<![\p{L}\p{N}*\\])\*\*(?=\S)([^*\n]+?)(?<=\S)(?<!\\)\*\*(?![\p{L}\p{N}*])/gu, '$1') // **bold**
        .replace(/(?<![\p{L}\p{N}_\\])__(?=\S)([^_\n]+?)(?<=\S)(?<!\\)__(?![\p{L}\p{N}_])/gu, '$1')     // __bold__
        .replace(/(?<![\p{L}\p{N}~\\])~~(?=\S)([^~\n]+?)(?<=\S)(?<!\\)~~(?![\p{L}\p{N}~])/gu, '$1')     // ~~strike~~
        .replace(/(?<![\p{L}\p{N}*\\])\*(?=\S)([^*\n]+?)(?<=\S)(?<!\\)\*(?![\p{L}\p{N}*])/gu, '$1')     // *italic*
        .replace(/(?<![\p{L}\p{N}_\\])_(?=\S)([^_\n]+?)(?<=\S)(?<!\\)_(?![\p{L}\p{N}_])/gu, '$1');      // _italic_

    // Restore protected code as its opaque inner text (markers around it already gone).
    return out.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => codes[Number(i)]);
}
