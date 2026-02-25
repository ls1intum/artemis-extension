import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [{
    files: ["**/*.ts"],
}, {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2022,
        sourceType: "module",
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

        // Prevent wildcard imports from lucide-react to maintain tree-shaking
        'no-restricted-imports': ['error', {
            patterns: [{
                group: ['lucide-react'],
                importNamePattern: '^\\*$',
                message: 'Do not use wildcard imports from lucide-react. Use named imports: import { IconName } from "lucide-react".',
            }],
        }],
    },
},
// Allow console.* in test files
{
    files: ["test/**/*.ts"],
    rules: {
        "no-console": "off",
    },
},
// Allow console.* in JavaScript config files (esbuild.js, etc.)
{
    files: ["**/*.js", "**/*.mjs"],
    rules: {
        "no-console": "off",
    },
}];