import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import simpleImportSort from "eslint-plugin-simple-import-sort";

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
        "simple-import-sort": simpleImportSort,
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
            patterns: [{
                group: ['..', '../*'],
                message: 'Use path aliases (@extension/, @webview/, @shared/, @test/, @root/package.json) instead of upward relative imports. Sibling imports (./foo) remain allowed.',
            }],
        }],

        'no-restricted-syntax': ['error',
            {
                // @typescript-eslint/parser emits ImportExpression for `import(...)`, not CallExpression.
                selector: 'ImportExpression > Literal[value=/^\\.\\.(?:\\/|$)/]',
                message: 'Use a path alias instead of an upward relative path in a dynamic import().',
            },
            {
                selector: 'CallExpression[callee.name="require"] > Literal[value=/^\\.\\.(?:\\/|$)/]',
                message: 'Use a path alias instead of an upward relative path in require().',
            },
            {
                selector: 'CallExpression[callee.object.name="require"][callee.property.name="resolve"] > Literal[value=/^\\.\\.(?:\\/|$)/]',
                message: 'Use a path alias instead of an upward relative path in require.resolve().',
            },
            {
                selector: 'CallExpression[callee.object.name="vi"][callee.property.name="mock"] > Literal[value=/^\\.\\.(?:\\/|$)/]',
                message: 'Use a path alias instead of an upward relative path in vi.mock().',
            },
            {
                selector: 'CallExpression[callee.object.name="vi"][callee.property.name="doMock"] > Literal[value=/^\\.\\.(?:\\/|$)/]',
                message: 'Use a path alias instead of an upward relative path in vi.doMock().',
            },
        ],

        // Sort and group imports/exports. Groups, in order:
        //   1. side-effect imports (CSS etc.) — kept first, relative order preserved
        //   2. external packages (node builtins, vscode, npm)
        //   3. @shared/* layer
        //   4. @extension/*, @webview/*, @test/*, @root/* layers
        //   5. relative imports
        // simple-import-sort reorders named members but does not format them;
        // comma-spacing normalises the separators it leaves behind.
        'comma-spacing': ['error', { before: false, after: true }],
        'simple-import-sort/imports': ['error', {
            groups: [
                ['^\\u0000'],
                ['^vscode$', '^node:', '^@(?!extension(?:/|$)|webview(?:/|$)|shared(?:/|$)|test(?:/|$)|root(?:/|$))', '^[a-z]'],
                ['^@shared(/|$)'],
                ['^@(extension|webview|test|root)(/|$)'],
                ['^\\.'],
            ],
        }],
        'simple-import-sort/exports': 'error',

        // Strict type-checking rules
        "@typescript-eslint/no-explicit-any": "error",
        "@typescript-eslint/no-unsafe-assignment": "error",
        "@typescript-eslint/no-unsafe-return": "error",
        "@typescript-eslint/no-unsafe-member-access": "error",
        "@typescript-eslint/no-unsafe-call": "error",
        "@typescript-eslint/no-unsafe-argument": "error",
    },
},
// Layer boundary: webview (browser) code must not import extension-host or test modules.
{
    files: ["src/webview/**/*.ts", "src/webview/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@extension', '@extension/*'],
                message: 'Webview (browser) code must not import extension-host modules. Put shared shapes in @shared.',
            }, {
                group: ['@test', '@test/*'],
                message: 'Production code must not import test helpers. @test/ is for test files only.',
            }, {
                group: ['..', '../*'],
                message: 'Use path aliases (@extension/, @webview/, @shared/, @test/, @root/package.json) instead of upward relative imports. Sibling imports (./foo) remain allowed.',
            }],
        }],
    },
},
// Layer boundary: extension-host code must not import webview or test modules.
{
    files: ["src/extension.ts", "src/extension/**/*.ts", "src/extension/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@webview', '@webview/*'],
                message: 'Extension-host code must not import webview modules. Put shared shapes in @shared.',
            }, {
                group: ['@test', '@test/*'],
                message: 'Production code must not import test helpers. @test/ is for test files only.',
            }, {
                group: ['..', '../*'],
                message: 'Use path aliases (@extension/, @webview/, @shared/, @test/, @root/package.json) instead of upward relative imports. Sibling imports (./foo) remain allowed.',
            }],
        }],
    },
},
// Layer boundary: shared code must not import extension-host, webview, or test modules.
{
    files: ["src/shared/**/*.ts", "src/shared/**/*.tsx"],
    rules: {
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['@extension', '@extension/*', '@webview', '@webview/*'],
                message: 'Shared code must not depend on extension-host or webview modules.',
            }, {
                group: ['@test', '@test/*'],
                message: 'Production code must not import test helpers. @test/ is for test files only.',
            }, {
                group: ['..', '../*'],
                message: 'Use path aliases (@extension/, @webview/, @shared/, @test/, @root/package.json) instead of upward relative imports. Sibling imports (./foo) remain allowed.',
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
        'no-restricted-imports': ['error', {
            paths: [lucideRestriction],
            patterns: [{
                group: ['..', '../*'],
                message: 'Use path aliases (@extension/, @webview/, @shared/, @test/, @root/package.json) instead of upward relative imports. Sibling imports (./foo) remain allowed.',
            }],
        }],
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
