import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

// Prevent ALL imports from the lucide-react barrel file to ensure tree-shaking.
// Icons must use direct paths: import Icon from 'lucide-react/dist/esm/icons/icon-name'.
// Type imports (import type { LucideIcon } from 'lucide-react') are allowed — erased at compile time.
const lucideRestriction = {
    name: 'lucide-react',
    message: 'Import icons from direct paths: import Icon from "lucide-react/dist/esm/icons/icon-name". Type imports (import type { ... } from "lucide-react") are allowed.',
    allowTypeImports: true,
};

export default [{
    files: ["**/*.ts", "**/*.tsx"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
        parserOptions: {
            project: "./tsconfig.json",
        },
    },

    rules: {
        "@typescript-eslint/naming-convention": ["warn", {
            selector: "import",
            format: ["camelCase", "PascalCase"],
        }],

        curly: "warn",
        eqeqeq: "warn",
        "no-throw-literal": "warn",
        semi: "warn",

        // Enforce usage of LoggingService instead of console.*
        // Only the loggingService.ts file is allowed to use console.* (with eslint-disable comments)
        "no-console": "error",

        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
        }],

        // Strict type-checking rules
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
    },
},
// Layer boundary: webview (browser) code must not import extension-host modules.
{
    files: ["src/webview/**/*.ts", "src/webview/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@extension', '@extension/*'],
                message: 'Webview (browser) code must not import extension-host modules. Put shared shapes in @shared.',
            }],
        }],
    },
},
// Layer boundary: extension-host code must not import webview modules.
{
    files: ["src/extension/**/*.ts", "src/extension/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@webview', '@webview/*'],
                message: 'Extension-host code must not import webview modules. Put shared shapes in @shared.',
            }],
        }],
    },
},
// Layer boundary: shared code must not import extension-host or webview modules.
{
    files: ["src/shared/**/*.ts", "src/shared/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@extension', '@extension/*', '@webview', '@webview/*'],
                message: 'Shared code must not depend on extension-host or webview modules.',
            }],
        }],
    },
},
// Allow console.* in test files, disable type-aware rules (tests not in main tsconfig project)
{
    files: ["test/**/*.ts", "test/**/*.tsx"],
    rules: {
        "no-console": "off",
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
    },
},
// Allow console.* in JavaScript config files, disable type-aware rules (not TypeScript)
{
    files: ["**/*.js", "**/*.mjs"],
    rules: {
        "no-console": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
    },
}];
