import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

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

        // Prevent ALL imports from lucide-react barrel file to ensure tree-shaking
        // Icons must use direct paths: import Icon from 'lucide-react/dist/esm/icons/icon-name'
        // Type imports (import type { LucideIcon } from 'lucide-react') are allowed — erased at compile time
        'no-restricted-imports': ['error', {
            paths: [{
                name: 'lucide-react',
                message: 'Import icons from direct paths: import Icon from "lucide-react/dist/esm/icons/icon-name". Type imports (import type { ... } from "lucide-react") are allowed.',
                allowTypeImports: true,
            }],
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
// Allow console.* in test files, disable type-aware rules (tests not in main tsconfig project)
{
    files: ["test/**/*.ts"],
    rules: {
        "no-console": "off",
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