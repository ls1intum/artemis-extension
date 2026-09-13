/**
 * Lint sources whose errors are NOT compilation errors.
 * [ADAPTATION] Paper had no linter; filter is engineering-necessary.
 *
 * Extracted to a standalone module so replay code can import without pulling in VS Code deps.
 */
export const LINT_SOURCE_DENYLIST: Set<string> = new Set([
    'eslint',
    'tslint',
    'stylelint',
    'checkstyle',
    'pmd',
    'spotbugs',
    'sonarlint',
]);
