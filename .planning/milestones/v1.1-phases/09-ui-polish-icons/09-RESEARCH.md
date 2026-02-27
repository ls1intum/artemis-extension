# Phase 9: UI Polish & Icons - Research

**Researched:** 2026-02-25
**Domain:** Icon migration, UI theming, problem statement rendering, webview panels
**Confidence:** HIGH

## Summary

Phase 9 migrates from custom SVG icon system (IconDefinitions.ts) to Lucide React for tree-shakable icons, re-enables fullscreen webview panels as VS Code editor tabs, and implements rich problem statement rendering with KaTeX math formulas and PlantUML diagrams. The phase focuses on VS Code native aesthetic alignment while maintaining Artemis branding through the logo.

The codebase already has lucide-react@0.575.0 installed, Shiki configured with JavaScript regex engine (CSP-safe), and PlantUML rendering infrastructure (artemisApi.renderPlantUmlToSvg). IconDefinitions.ts contains 40+ custom SVG strings used via `getIcon()` and dangerouslySetInnerHTML injection. The migration replaces string-based icon injection with React component rendering, enabling tree-shaking to reduce bundle size (currently 3.5MB).

**Primary recommendation:** Replace IconDefinitions.ts with typed const map (ICONS.programming → Lucide component) preserving dynamic exercise type mapping while enabling tree-shaking. Use VS Code CSS variables for theming, implement KaTeX for math formulas, and create fullscreen panel command that opens webview as editor tab via vscode.window.createWebviewPanel() with retainContextWhenHidden: true for state preservation.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Icon Identity & Mapping:**
- All icons migrate to Lucide — no exceptions except the Artemis logo
- Artemis logo stays as a standalone React component (ArtemisLogo.tsx) with size/color props matching Lucide's API
- IconDefinitions.ts becomes a typed const map (ICONS.programming, ICONS.quiz) mapping domain names to Lucide components
- Full audit of all icon usages across codebase — migrate every getIcon() call and raw SVG injection to React component imports
- Exercise type indicators display as icon only (no text label)

**Icon Theming:**
- Single CSS variable --icon-color tied to VS Code theme tokens (e.g., --vscode-icon-foreground)
- Icons have hover + active state color changes for interactive elements
- VS Code semantic colors for accents (success, error, etc.) — not Artemis's custom palette

**Icon Sizing & Density:**
- Two size tiers: 16px default, 24px for section headers and primary actions
- Icon buttons have padded hit targets (~28-32px clickable area around 16px icons)
- Background highlight on hover for icon buttons (matching VS Code toolbar button pattern)

**Fullscreen Panel UX:**
- Opens as a VS Code editor tab via vscode.window.createWebviewPanel()
- Reuses the same React components as the sidebar view — components respond to wider space responsively
- Triggered by: expand/maximize icon button in exercise/course view header + command palette commands
- Tab title shows the exercise or course name (e.g., "Exercise: Binary Search", "Course: Algorithms")

**Problem Statement Styling:**
- VS Code native documentation feel — styled to match VS Code's markdown preview aesthetic
- Full element coverage: paragraphs, headings, code blocks, lists, tables, blockquotes, horizontal rules, images
- Syntax highlighting in code blocks via Shiki (already in project)
- KaTeX rendering for LaTeX math formulas
- PlantUML diagrams rendered inline as SVG via Artemis server API (/api/programming/plantuml/svg) — reuse existing PlantUmlCommandModule infrastructure
- Clickable links open in external browser via VS Code URI handler
- Images clickable — open in VS Code's built-in image preview tab
- No collapsible sections — all content displays flat
- No container border/background — problem statement blends seamlessly into the exercise detail view
- Task/subtask markers: bold + colored text prefix (e.g., bold "Task 1:" in accent color)
- Max-width 800px maintained
- No copy button on code blocks

**Artemis Visual Alignment:**
- VS Code extension identity first — native VS Code conventions, theming, and patterns
- Artemis branding limited to the logo only
- Icon choices are best Lucide match independently — not trying to replicate Artemis web's specific icons
- VS Code semantic colors (--vscode-testing-iconPassed, --vscode-errorForeground) for status/accent colors

### Claude's Discretion

- Specific Lucide icon choices for each domain type (programming, quiz, modeling, etc.)
- Accessibility attributes (aria-labels, screen reader support) for icon buttons
- Animation/transition details for hover states
- Exact spacing and typography refinements
- Error state handling and loading indicators

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| UI-01 | All custom SVG icons (IconDefinitions.ts) migrated to Lucide React components with named imports for tree-shaking | Lucide React supports tree-shaking with named imports — only imported icons bundled. Standard Stack section provides installation and usage patterns. Architecture Patterns section shows typed const map approach for dynamic exercise type mapping. |
| UI-02 | Fullscreen panel support re-enabled and functional | VS Code createWebviewPanel() API creates editor tab webviews with retainContextWhenHidden option for state preservation. Architecture Patterns section documents command registration and panel lifecycle. |
| UI-03 | Exercise detail page renders problem statement content correctly | Existing Shiki (syntax highlighting), PlantUML infrastructure (renderPlantUmlToSvg), DOMPurify (XSS protection) provide foundation. KaTeX integration pattern documented in Standard Stack. Architecture Patterns shows VS Code markdown preview CSS variable usage for native aesthetic. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| lucide-react | 0.575.0 (installed) | Icon library with 1400+ icons | Industry standard for React icons with tree-shaking support, active maintenance, VS Code-friendly aesthetic |
| Shiki | 3.22.0 (installed) | Syntax highlighting | Already configured with JavaScript regex engine (CSP-safe), used in Iris chat CodeBlock component |
| KaTeX | 0.16.x (recommended) | LaTeX math rendering | Fast, self-contained, no MathJax dependencies, widely used for math formulas in technical content |
| DOMPurify | 3.3.1 (installed) | HTML sanitization | Already used for XSS protection in markdown rendering |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| markdown-it | Not installed | Markdown parser | Consider if KaTeX integration requires markdown-it-katex plugin (alternative: post-process HTML with KaTeX API directly) |
| react-katex | Not recommended | React wrapper for KaTeX | Unnecessary — KaTeX can be used directly via its JavaScript API for better control |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Lucide React | React Icons | Heavier bundle (no tree-shaking by default), less VS Code-native aesthetic |
| KaTeX | MathJax | Slower initial render, larger bundle, MathJax v3+ improved but KaTeX still faster for static content |
| Named imports | Dynamic icon import system | More flexible but prevents tree-shaking, increases bundle size significantly |

**Installation:**

```bash
npm install katex @types/katex
```

Note: lucide-react, shiki, and dompurify already installed

## Architecture Patterns

### Current Icon System (Pre-Migration)

**IconDefinitions.ts structure:**
```typescript
export class IconDefinitions {
    private static readonly icons: Record<string, string> = {
        'programming': `<svg viewBox="0 0 576 512">...</svg>`,
        'quiz': `<svg viewBox="0 0 24 24">...</svg>`,
        'modeling': `<svg viewBox="0 0 24 24">...</svg>`,
        // 40+ more icons
    };

    public static getIcon(type: string): string {
        const normalizedType = type?.toLowerCase().replace(/_/g, '-') || 'default';
        return this.icons[normalizedType] || this.icons['default'];
    }
}
```

**Current usage pattern (dangerouslySetInnerHTML injection):**
```tsx
// src/views/webview/react/views/ExamConduction/components/ExerciseList.tsx
const icon = IconDefinitions.getIcon(exercise.type || 'default');

<span
    className={styles.exerciseTypeIcon}
    dangerouslySetInnerHTML={{ __html: icon }}
/>
```

This pattern:
- Returns SVG strings, not React components
- All 40+ icons bundled even if only 2 used (no tree-shaking)
- Requires dangerouslySetInnerHTML (security risk, less React-idiomatic)
- No type safety for icon names
- Dynamic exercise types from API work via fallback to 'default'

### Recommended Pattern 1: Typed Icon Mapping with Named Imports

**New structure (preserves dynamic mapping + enables tree-shaking):**

```typescript
// src/utils/iconMap.ts
import {
    Code2,           // programming
    CheckCircle,     // quiz
    Box,             // modeling
    FileText,        // text
    Upload,          // file-upload
    GraduationCap,   // course
    ClipboardList,   // exercise
    type LucideIcon
} from 'lucide-react';

// Typed const map for autocomplete and type safety
export const ICONS = {
    programming: Code2,
    quiz: CheckCircle,
    modeling: Box,
    text: FileText,
    'file-upload': Upload,
    course: GraduationCap,
    exercise: ClipboardList,
    default: ClipboardList,
} as const satisfies Record<string, LucideIcon>;

// Type for valid icon keys
export type IconKey = keyof typeof ICONS;

// Helper for dynamic exercise types from Artemis API
export function getIcon(type: string | undefined): LucideIcon {
    const normalizedType = type?.toLowerCase().replace(/_/g, '-') || 'default';
    return ICONS[normalizedType as IconKey] || ICONS.default;
}
```

**Usage in components:**

```tsx
// Static usage (best — explicit imports)
import { Code2 } from 'lucide-react';

<Code2 size={16} className={styles.icon} />

// Dynamic usage (exercise types from API)
import { getIcon } from '../../utils/iconMap';

const IconComponent = getIcon(exercise.type);
<IconComponent size={16} className={styles.icon} />
```

**Why this works:**
- Named imports enable tree-shaking — only imported icons bundled
- Typed const map provides autocomplete and type safety
- Dynamic API types still work via getIcon() helper with fallback
- No dangerouslySetInnerHTML needed
- Icon components can accept props (size, color, strokeWidth)

### Recommended Pattern 2: Artemis Logo Component

**ArtemisLogo.tsx (matching Lucide API):**

```tsx
// src/components/icons/ArtemisLogo.tsx
import type { LucideProps } from 'lucide-react';

export function ArtemisLogo({
    size = 24,
    color = 'currentColor',
    strokeWidth = 2,
    className,
    ...props
}: LucideProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={size}
            height={size}
            viewBox="0 0 232 204"
            fill="none"
            className={className}
            {...props}
        >
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M151 66L112 99.8764L229 201L151 66Z"
                stroke={color}
                strokeWidth={strokeWidth}
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M0 198.5L153.5 65L115.5 0L0 198.5Z"
                fill={color}
            />
        </svg>
    );
}
```

**Usage:**
```tsx
import { ArtemisLogo } from './components/icons/ArtemisLogo';

<ArtemisLogo size={32} color="var(--vscode-icon-foreground)" />
```

### Recommended Pattern 3: Icon Button Theming

**CSS variables for theme-aware icons:**

```css
/* Global theme variables */
:root {
    --icon-color: var(--vscode-icon-foreground);
    --icon-color-hover: var(--vscode-list-hoverForeground);
    --icon-color-active: var(--vscode-list-activeSelectionForeground);
    --icon-button-bg-hover: var(--vscode-toolbar-hoverBackground);
}
```

**IconButton component update:**

```tsx
// src/views/webview/react/components/Button/IconButton.tsx
import type { LucideIcon } from 'lucide-react';

export interface IconButtonProps {
    Icon: LucideIcon;  // Changed from ReactNode to LucideIcon
    onClick?: () => void;
    ariaLabel: string;
    disabled?: boolean;
    size?: number;
    className?: string;
}

export function IconButton({
    Icon,
    onClick,
    ariaLabel,
    disabled = false,
    size = 16,
    className,
}: IconButtonProps) {
    return (
        <button
            type="button"
            className={clsx(styles.iconBtn, disabled && styles.iconBtnDisabled, className)}
            disabled={disabled}
            onClick={onClick}
            aria-label={ariaLabel}
        >
            <Icon size={size} strokeWidth={2} />
        </button>
    );
}
```

**IconButton.module.css:**

```css
.iconBtn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 6px;  /* 16px icon + 6px padding = 28px hit target */
    border: none;
    background: transparent;
    color: var(--icon-color);
    cursor: pointer;
    border-radius: 5px;
    transition: background-color 0.15s ease, color 0.15s ease;
}

.iconBtn:hover:not(:disabled) {
    background: var(--icon-button-bg-hover);
    color: var(--icon-color-hover);
}

.iconBtn:active:not(:disabled) {
    color: var(--icon-color-active);
}

.iconBtn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
```

### Recommended Pattern 4: Fullscreen Webview Panel

**Command registration (extension.ts):**

```typescript
// Register fullscreen commands
context.subscriptions.push(
    vscode.commands.registerCommand('artemis.openExerciseFullscreen', (exerciseId: number) => {
        openExercisePanel(context.extensionUri, exerciseId);
    }),
    vscode.commands.registerCommand('artemis.openCourseFullscreen', (courseId: number) => {
        openCoursePanel(context.extensionUri, courseId);
    })
);
```

**Panel creation (new file: src/provider/fullscreenPanelProvider.ts):**

```typescript
import * as vscode from 'vscode';

export function openExercisePanel(
    extensionUri: vscode.Uri,
    exerciseId: number
): void {
    const panel = vscode.window.createWebviewPanel(
        'artemis.exerciseFullscreen',
        'Exercise: Loading...', // Updated with exercise title after init
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,  // Preserve state when tab hidden
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
        }
    );

    // Reuse existing React webview HTML generation
    panel.webview.html = getWebviewHtml(panel.webview, extensionUri);

    // Post init message with exerciseId
    panel.webview.postMessage({
        type: 'exerciseDetailInit',
        payload: { exerciseId, isFullscreen: true }
    });

    // Listen for title updates from webview
    panel.webview.onDidReceiveMessage(message => {
        if (message.type === 'updateTitle') {
            panel.title = `Exercise: ${message.title}`;
        }
    });
}
```

**React component detection of fullscreen mode:**

```tsx
// ExerciseDetailView.tsx
useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
        if (event.data.type === 'exerciseDetailInit') {
            const { exerciseId, isFullscreen } = event.data.payload;
            setIsFullscreen(isFullscreen);
            loadExerciseDetail(exerciseId);

            // Update panel title
            if (isFullscreen && exercise?.title) {
                vscodeApi.postMessage({
                    type: 'updateTitle',
                    title: exercise.title
                });
            }
        }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
}, [exercise?.title]);
```

**Responsive CSS for fullscreen:**

```css
/* ExerciseDetailView.module.css */
.exerciseDetail {
    max-width: 800px;  /* Sidebar constraint */
    margin: 0 auto;
}

/* Fullscreen mode — allow wider layout */
.exerciseDetail[data-fullscreen="true"] {
    max-width: 1200px;  /* More breathing room in editor area */
}
```

### Recommended Pattern 5: KaTeX Math Rendering

**Installation and setup:**

```typescript
// src/utils/katexRenderer.ts
import katex from 'katex';
import 'katex/dist/katex.min.css';  // Import KaTeX styles

export function renderMath(latex: string, displayMode = false): string {
    try {
        return katex.renderToString(latex, {
            displayMode,  // true for block math ($$...$$), false for inline ($...$)
            throwOnError: false,  // Show original LaTeX if parsing fails
            errorColor: 'var(--vscode-errorForeground)',
        });
    } catch (error) {
        console.error('KaTeX rendering error:', error);
        return latex;  // Fallback to original text
    }
}
```

**Problem statement processing:**

```typescript
// src/utils/problemStatementProcessor.ts
import DOMPurify from 'dompurify';
import { renderMath } from './katexRenderer';

export function processProblemStatement(html: string): string {
    // 1. Sanitize HTML first
    let processed = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
                       'code', 'pre', 'a', 'img', 'table', 'thead', 'tbody', 'tr',
                       'th', 'td', 'blockquote', 'hr', 'strong', 'em', 'br'],
        ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class']
    });

    // 2. Replace inline math ($...$)
    processed = processed.replace(/\$([^\$]+)\$/g, (match, latex) => {
        return renderMath(latex, false);
    });

    // 3. Replace block math ($$...$$)
    processed = processed.replace(/\$\$([^\$]+)\$\$/g, (match, latex) => {
        return renderMath(latex, true);
    });

    // 4. Process PlantUML placeholders (if needed)
    // Assuming PlantUML diagrams are pre-rendered server-side or marked with data attributes
    // This step depends on Artemis API response format

    return processed;
}
```

**React component usage:**

```tsx
// ProblemStatement.tsx
import { processProblemStatement } from '../../../utils/problemStatementProcessor';

export function ProblemStatement({ markdown }: ProblemStatementProps) {
    const processedHtml = useMemo(() => processProblemStatement(markdown), [markdown]);

    return (
        <Container header={<h3>Exercise Description</h3>}>
            <div
                className={styles.problemStatement}
                dangerouslySetInnerHTML={{ __html: processedHtml }}
            />
        </Container>
    );
}
```

### Recommended Pattern 6: PlantUML Integration

**Reuse existing infrastructure:**

The codebase already has PlantUML rendering via:
- `src/api/artemisApi.ts` — `renderPlantUmlToSvg(plantUml: string, isDarkTheme: boolean)`
- `src/views/app/commands/plantUmlCommands.ts` — PlantUmlCommandModule with renderPlantUmlInline handler
- `src/utils/plantUmlProcessor.ts` — processPlantUml() for testsColor replacement

**Inline rendering strategy:**

```tsx
// ProblemStatement.tsx — handle PlantUML diagrams
useEffect(() => {
    // After HTML is rendered, find PlantUML placeholders
    const plantUmlElements = document.querySelectorAll('[data-plantuml]');

    plantUmlElements.forEach(async (element, index) => {
        const plantUmlCode = element.getAttribute('data-plantuml');
        if (!plantUmlCode) return;

        // Request rendering from extension
        vscodeApi.postMessage({
            type: 'command',
            command: 'renderPlantUmlInline',
            plantUml: plantUmlCode,
            index
        });
    });

    // Listen for rendered SVG
    const handleMessage = (event: MessageEvent) => {
        if (event.data.command === 'plantUmlRendered') {
            const { index, svg } = event.data;
            const element = document.querySelector(`[data-plantuml-index="${index}"]`);
            if (element) {
                element.innerHTML = svg;
            }
        }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
}, [processedHtml]);
```

**Alternative: Server-side rendering (preferred):**

If Artemis API returns problem statements with PlantUML already rendered to SVG:
- No client-side processing needed
- Sanitize with DOMPurify (allow `<svg>` tags)
- Render directly with dangerouslySetInnerHTML

**From Phase 8 audit:** PlantUmlCommandModule already handles theme detection (isDarkTheme) and server API calls. Reuse existing renderPlantUmlToSvg() method.

### VS Code Theme Integration

**CSS variable reference for problem statement styling:**

```css
/* ProblemStatement.module.css — VS Code native aesthetic */
.problemStatement {
    max-width: 800px;
    line-height: 1.6;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
}

.problemStatement h1,
.problemStatement h2,
.problemStatement h3 {
    color: var(--vscode-editor-foreground);
    font-weight: 600;
    margin-top: 24px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--vscode-widget-border);
    padding-bottom: 8px;
}

.problemStatement code {
    background: var(--vscode-textCodeBlock-background);
    color: var(--vscode-textPreformat-foreground);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: var(--vscode-editor-font-family);
}

.problemStatement pre {
    background: var(--vscode-textCodeBlock-background);
    padding: 12px;
    border-radius: 4px;
    overflow-x: auto;
    border: 1px solid var(--vscode-widget-border);
}

.problemStatement a {
    color: var(--vscode-textLink-foreground);
    text-decoration: none;
}

.problemStatement a:hover {
    color: var(--vscode-textLink-activeForeground);
    text-decoration: underline;
}

.problemStatement blockquote {
    border-left: 4px solid var(--vscode-textBlockQuote-border);
    background: var(--vscode-textBlockQuote-background);
    padding: 8px 16px;
    margin: 16px 0;
}

.problemStatement table {
    border-collapse: collapse;
    width: 100%;
    margin: 16px 0;
}

.problemStatement th,
.problemStatement td {
    border: 1px solid var(--vscode-widget-border);
    padding: 8px 12px;
    text-align: left;
}

.problemStatement th {
    background: var(--vscode-list-hoverBackground);
    font-weight: 600;
}

.problemStatement img {
    max-width: 100%;
    height: auto;
    cursor: pointer;
    border: 1px solid var(--vscode-widget-border);
    border-radius: 4px;
    margin: 16px 0;
}

/* Task markers */
.problemStatement .task-marker {
    font-weight: 600;
    color: var(--vscode-testing-iconPassed);  /* VS Code accent color */
}
```

**Clickable image handler:**

```tsx
// ProblemStatement.tsx
useEffect(() => {
    const images = document.querySelectorAll('.problemStatement img');

    images.forEach(img => {
        img.addEventListener('click', () => {
            const src = img.getAttribute('src');
            if (src) {
                vscodeApi.postMessage({
                    type: 'command',
                    command: 'openImagePreview',
                    uri: src
                });
            }
        });
    });
}, [processedHtml]);
```

**Extension command to open image:**

```typescript
// extension.ts
context.subscriptions.push(
    vscode.commands.registerCommand('artemis.openImagePreview', (uri: string) => {
        vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(uri));
    })
);
```

### Anti-Patterns to Avoid

**Anti-pattern 1: Wildcard icon imports**
```typescript
// ❌ BAD — prevents tree-shaking
import * as Icons from 'lucide-react';
const Icon = Icons[iconName];
```

**Anti-pattern 2: Inline KaTeX styles**
```tsx
// ❌ BAD — CSP violation, no theme support
<div dangerouslySetInnerHTML={{ __html: katex.renderToString(latex, { output: 'html' }) }} />
```

**Anti-pattern 3: Direct SVG string injection**
```tsx
// ❌ BAD — no tree-shaking, security risk
<span dangerouslySetInnerHTML={{ __html: IconDefinitions.getIcon(type) }} />
```

**Anti-pattern 4: Hardcoded icon colors**
```tsx
// ❌ BAD — breaks dark theme
<Code2 color="#000000" />
```

Instead, use currentColor or CSS variables:
```tsx
// ✅ GOOD — theme-aware
<Code2 color="currentColor" />
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Math rendering | Custom LaTeX parser | KaTeX library | Complex grammar, Unicode edge cases, performance optimizations already solved |
| Icon system | Custom SVG sprite generation | Lucide React named imports | Tree-shaking, React component API, accessibility attributes built-in |
| Markdown parsing | Regex-based HTML generation | DOMPurify sanitization + KaTeX post-processing | XSS protection, whitelist management, edge case handling |
| Syntax highlighting | Custom tokenizer | Shiki (already configured) | Language grammars, theme support, CSP-safe JavaScript engine |
| PlantUML rendering | Client-side diagram generation | Artemis server API (already implemented) | Complex diagram syntax, server-side caching, theme handling |

**Key insight:** Icon libraries and rendering libraries have mature ecosystems with accessibility, performance, and security considerations already handled. Custom implementations would require significant effort to match feature parity and battle-tested reliability.

## Common Pitfalls

### Pitfall 1: Icon Bundle Bloat from Dynamic Imports

**What goes wrong:**
Using dynamic imports based on string names (e.g., `import('lucide-react')[iconName]`) defeats tree-shaking, bundling all 1400+ icons (~300KB) even if only 10 are used.

**Why it happens:**
Bundlers can't statically analyze dynamic imports with runtime string values. They must include all possible icons to ensure runtime availability.

**How to avoid:**
Use the typed const map pattern (ICONS object) shown in Architecture Patterns. Import icons explicitly at the top of iconMap.ts, then reference them via the map for dynamic exercise types.

**Warning signs:**
- Bundle size increase >200KB after icon migration
- esbuild-visualizer shows entire lucide-react library in bundle
- All icon imports appear in bundle even if not used in code

**Verification:**
```bash
npm run build:analyze
# Check dist/meta.json for lucide-react size
# Should see <50KB if tree-shaking works correctly (vs 300KB+ without)
```

### Pitfall 2: CSP Violations with KaTeX

**What goes wrong:**
KaTeX's default HTML output mode injects inline styles, violating VS Code webview CSP (Content Security Policy). Webview fails to load or math renders without styling.

**Why it happens:**
VS Code webviews have strict CSP: `style-src 'nonce-{random}' 'unsafe-inline'` requires nonces for inline styles. KaTeX's HTML output doesn't use nonces.

**How to avoid:**
- Import KaTeX CSS stylesheet globally: `import 'katex/dist/katex.min.css'`
- Use KaTeX with output: 'html' mode (generates class-based HTML, not inline styles)
- Ensure webview HTML includes KaTeX CSS via nonce-tagged `<style>` or `<link>` tag

**Warning signs:**
- Math formulas render as unstyled text
- Browser console shows CSP errors: "Refused to apply inline style"
- KaTeX elements visible in DOM but no styling applied

**Verification:**
```typescript
// Check webview HTML generation includes KaTeX CSS
const katexCss = fs.readFileSync(path.join(__dirname, 'node_modules/katex/dist/katex.min.css'), 'utf8');
html += `<style nonce="${nonce}">${katexCss}</style>`;
```

### Pitfall 3: Icon Color Inheritance Breaking

**What goes wrong:**
Icons use `currentColor` for stroke/fill but parent element color isn't set, causing icons to inherit unexpected colors from grandparent elements. Results in invisible icons on certain backgrounds.

**Why it happens:**
CSS `color` property inherits through DOM tree. If button has no explicit color, icon inherits from distant ancestor with theme-inappropriate color (e.g., white icon on white background).

**How to avoid:**
Always set `color` on icon button container:
```css
.iconBtn {
    color: var(--icon-color);  /* Explicit color, not inherited */
}
```

**Warning signs:**
- Icons disappear when theme switches from light to dark (or vice versa)
- Icon visibility differs between views despite same component
- Hover states work but default state invisible

### Pitfall 4: Fullscreen Panel State Loss on Hide

**What goes wrong:**
User opens exercise in fullscreen, switches to code editor tab, returns to exercise tab — all UI state (scroll position, expanded sections) is lost. Webview reloaded from scratch.

**Why it happens:**
By default, VS Code disposes webview content when panel is hidden (viewColumn changes). Without `retainContextWhenHidden: true`, webview re-initializes every time.

**How to avoid:**
Set `retainContextWhenHidden: true` in createWebviewPanel options (shown in Architecture Patterns).

**Warning signs:**
- Users report "exercise keeps reloading"
- Scroll position resets to top when returning to tab
- Form inputs cleared when switching tabs

**Verification:**
```typescript
const panel = vscode.window.createWebviewPanel(
    'artemis.exerciseFullscreen',
    'Exercise',
    vscode.ViewColumn.One,
    {
        retainContextWhenHidden: true,  // CRITICAL
        enableScripts: true
    }
);
```

### Pitfall 5: PlantUML Diagram Theme Mismatch

**What goes wrong:**
PlantUML diagrams rendered in light theme but webview is in dark theme (or vice versa), causing poor contrast and illegible text.

**Why it happens:**
PlantUML server API requires theme parameter (isDarkTheme boolean). If not provided or incorrect, diagrams render with wrong color scheme.

**How to avoid:**
Pass correct theme to renderPlantUmlToSvg():
```typescript
const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
const svg = await artemisApi.renderPlantUmlToSvg(plantUml, isDarkTheme);
```

Existing PlantUmlCommandModule already does this (line 63 in plantUmlCommands.ts) — reuse this infrastructure.

**Warning signs:**
- Light-colored text on light background (or dark on dark)
- Diagrams look correct in one theme but unreadable in another
- Users report "can't read PlantUML diagrams"

## Code Examples

Verified patterns from official sources and existing codebase.

### Lucide React Named Imports (Tree-Shaking)

Source: [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react)

```tsx
// ✅ CORRECT — only imported icons bundled
import { Code2, CheckCircle, Box } from 'lucide-react';

function ExerciseIcon({ type }: { type: string }) {
    const iconMap: Record<string, typeof Code2> = {
        programming: Code2,
        quiz: CheckCircle,
        modeling: Box
    };

    const Icon = iconMap[type] || CheckCircle;
    return <Icon size={16} strokeWidth={2} />;
}
```

### KaTeX Math Rendering

Source: [KaTeX JavaScript API](https://katex.org/docs/api.html)

```typescript
import katex from 'katex';
import 'katex/dist/katex.min.css';

// Inline math: $E = mc^2$
const inlineMath = katex.renderToString('E = mc^2', {
    displayMode: false,
    throwOnError: false
});

// Block math: $$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$
const blockMath = katex.renderToString('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', {
    displayMode: true,
    throwOnError: false
});
```

### VS Code Webview Panel Creation

Source: [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)

```typescript
import * as vscode from 'vscode';

export function openExercisePanel(
    extensionUri: vscode.Uri,
    exerciseId: number
): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(
        'artemis.exerciseFullscreen',  // viewType
        'Exercise: Loading...',          // title
        vscode.ViewColumn.One,           // column
        {
            enableScripts: true,
            retainContextWhenHidden: true,  // Preserve state when hidden
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')]
        }
    );

    // Panel lifecycle hooks
    panel.onDidDispose(() => {
        console.log('Panel disposed');
    });

    panel.onDidChangeViewState(e => {
        console.log('Panel visibility:', e.webviewPanel.visible);
    });

    return panel;
}
```

### Shiki Syntax Highlighting (Existing Pattern)

Source: iris-thaumantias/src/views/webview/react/views/IrisChat/components/CodeBlock.tsx

```tsx
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// Singleton highlighter instance (CSP-safe JavaScript engine)
let highlighterPromise: ReturnType<typeof createHighlighterCore> | null = null;

const getHighlighter = () => {
    if (!highlighterPromise) {
        highlighterPromise = createHighlighterCore({
            themes: [
                import('shiki/themes/github-dark.mjs'),
                import('shiki/themes/github-light.mjs'),
            ],
            langs: [
                import('shiki/langs/java.mjs'),
                import('shiki/langs/python.mjs'),
                import('shiki/langs/c.mjs'),
                import('shiki/langs/javascript.mjs'),
                import('shiki/langs/typescript.mjs'),
            ],
            engine: createJavaScriptRegexEngine(),  // CSP-safe
        });
    }
    return highlighterPromise;
};

// Usage in component
const highlighter = await getHighlighter();
const html = highlighter.codeToHtml(code, {
    lang: 'java',
    theme: 'github-dark'
});
```

### PlantUML Inline Rendering (Existing Pattern)

Source: iris-thaumantias/src/views/app/commands/plantUmlCommands.ts

```typescript
// Extension command handler (existing infrastructure)
private handleRenderPlantUmlInline = async (message: any): Promise<void> => {
    const plantUml: string = message.plantUml;
    const index: number = message.index;

    try {
        const processedPlantUml = processPlantUml(plantUml);  // testsColor replacement
        const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
        const svg = await this.context.artemisApi.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

        // Send SVG back to webview
        this.context.sendMessage({
            command: 'plantUmlRendered',
            index: index,
            svg: svg
        });
    } catch (error) {
        this.context.sendMessage({
            command: 'plantUmlError',
            index: index,
            error: error.message
        });
    }
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Font Awesome icon font | Lucide React SVG components | 2023-2024 | Tree-shaking enabled, modern React patterns, better accessibility |
| MathJax v2 | KaTeX or MathJax v3 | 2021-2022 | 2-5x faster initial render, smaller bundle, better TypeScript support |
| Custom SVG sprite sheets | Named imports from icon libraries | 2022-2023 | No build step for sprites, automatic tree-shaking, component-based API |
| WebviewView only | WebviewPanel for fullscreen | Always supported | Editor tab integration, better UX for focused content viewing |
| markdown-it + custom plugins | markdown-it + official plugins or direct KaTeX API | Ongoing | Better maintenance, official plugin support, simpler setup |

**Deprecated/outdated:**
- Custom icon fonts (CORS/CSP issues in webviews, no tree-shaking, maintenance burden)
- MathJax v2 (deprecated, slower, larger bundle, TypeScript issues)
- Inline styles in webview (CSP violations with strict nonce requirements)
- WebviewView without retainContextWhenHidden (state loss on hide, poor UX)

## Open Questions

1. **Icon mapping completeness**
   - What we know: IconDefinitions.ts has 40+ icons, Artemis API can return arbitrary exercise types
   - What's unclear: Full list of exercise types from Artemis API (programming, quiz, modeling, text, file-upload confirmed; others unknown)
   - Recommendation: Audit CourseDetailView and ExerciseDetailView for all exercise.type values; map to best Lucide matches; use fallback icon (ClipboardList) for unknown types

2. **KaTeX vs markdown-it-katex plugin**
   - What we know: KaTeX standalone API works for post-processing HTML; markdown-it-katex plugin integrates at parse time
   - What's unclear: Does Artemis API return raw markdown or pre-rendered HTML for problem statements?
   - Recommendation: Check API response format first; if HTML: use KaTeX API directly (simpler); if markdown: consider markdown-it + markdown-it-katex (more robust parsing)

3. **Fullscreen panel command discoverability**
   - What we know: VS Code command palette shows all registered commands
   - What's unclear: Should fullscreen button be in exercise/course header always, or only when specific conditions met?
   - Recommendation: Always show fullscreen button in header (top-right corner) for consistency; register commands for power users (Cmd+Shift+P)

## Validation Architecture

This section omitted — workflow.nyquist_validation not enabled in .planning/config.json.

## Sources

### Primary (HIGH confidence)

- [Lucide React Documentation](https://lucide.dev/guide/packages/lucide-react) - Icon library API, tree-shaking guidance
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview) - Panel creation, lifecycle, retainContextWhenHidden
- [KaTeX API Documentation](https://katex.org/docs/api.html) - Math rendering, configuration options
- Codebase analysis:
  - iris-thaumantias/src/utils/iconDefinitions.ts - Current icon system structure
  - iris-thaumantias/src/views/webview/react/views/IrisChat/components/CodeBlock.tsx - Shiki configuration
  - iris-thaumantias/src/views/app/commands/plantUmlCommands.ts - PlantUML rendering infrastructure
  - iris-thaumantias/package.json - lucide-react@0.575.0, shiki@3.22.0 already installed

### Secondary (MEDIUM confidence)

- [Tree-shaking Lucide React with Vite](https://javascript.plainenglish.io/tree-shaking-lucide-react-icons-with-vite-and-vitest-57bf4cfe6032) - Vite optimization patterns, build time improvements
- [VS Code Markdown-it-KaTeX Plugin](https://github.com/microsoft/vscode-markdown-it-katex) - Official Microsoft plugin for KaTeX in markdown
- [React Webview UI Toolkit](https://githubnext.com/projects/react-webview-ui-toolkit/) - Microsoft's React component library for webviews
- [Using React in VS Code Webviews](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) - Community guide for React integration

### Tertiary (LOW confidence)

- [Top 10 Icon Libraries for React](https://medium.com/@reactjsbd/top-10-icon-libraries-for-react-development-a-comprehensive-guide-e7b4b6795027) - General comparison, not VS Code-specific
- [Lucide Icons with Vite Dev Server](https://christopher.engineering/en/blog/lucide-icons-with-vite-dev-server) - Dev server optimization, not production build

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - lucide-react, shiki, katex are mature libraries with official documentation; lucide-react and shiki already in project
- Architecture: HIGH - Patterns based on existing codebase structure (IconButton component, Shiki setup, PlantUML commands); VS Code API patterns from official docs
- Pitfalls: MEDIUM-HIGH - Common issues documented in community guides and GitHub issues; CSP and tree-shaking pitfalls verified with official docs

**Research date:** 2026-02-25
**Valid until:** 2026-03-27 (30 days - stable stack, mature libraries)
