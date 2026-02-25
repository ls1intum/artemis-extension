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