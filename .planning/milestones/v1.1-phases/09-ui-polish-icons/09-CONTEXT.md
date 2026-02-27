# Phase 9: UI Polish & Icons - Context

**Gathered:** 2026-02-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate the custom SVG icon system (IconDefinitions.ts) to Lucide React components, re-enable fullscreen exercise/course panels as VS Code editor tabs, and fix exercise problem statement rendering with full formatting support. The Artemis logo remains the only custom SVG.

</domain>

<decisions>
## Implementation Decisions

### Icon Identity & Mapping
- All icons migrate to Lucide — no exceptions except the Artemis logo
- Artemis logo stays as a standalone React component (ArtemisLogo.tsx) with size/color props matching Lucide's API
- IconDefinitions.ts becomes a typed const map (`ICONS.programming`, `ICONS.quiz`) mapping domain names to Lucide components — replaces string-key `getIcon()` API
- Full audit of all icon usages across codebase — migrate every `getIcon()` call and raw SVG injection to React component imports
- Exercise type indicators display as icon only (no text label)

### Icon Theming
- Single CSS variable `--icon-color` tied to VS Code theme tokens (e.g., `--vscode-icon-foreground`)
- Icons have hover + active state color changes for interactive elements
- VS Code semantic colors for accents (success, error, etc.) — not Artemis's custom palette

### Icon Sizing & Density
- Two size tiers: 16px default, 24px for section headers and primary actions
- Icon buttons have padded hit targets (~28-32px clickable area around 16px icons)
- Background highlight on hover for icon buttons (matching VS Code toolbar button pattern)

### Fullscreen Panel UX
- Opens as a VS Code editor tab via `vscode.window.createWebviewPanel()`
- Reuses the same React components as the sidebar view — components respond to wider space responsively
- Triggered by: expand/maximize icon button in exercise/course view header + command palette commands
- Tab title shows the exercise or course name (e.g., "Exercise: Binary Search", "Course: Algorithms")

### Problem Statement Styling
- VS Code native documentation feel — styled to match VS Code's markdown preview aesthetic
- Full element coverage: paragraphs, headings, code blocks, lists, tables, blockquotes, horizontal rules, images
- Syntax highlighting in code blocks via Shiki (already in project)
- KaTeX rendering for LaTeX math formulas
- PlantUML diagrams rendered inline as SVG via Artemis server API (`/api/programming/plantuml/svg`) — reuse existing PlantUmlCommandModule infrastructure
- Clickable links open in external browser via VS Code URI handler
- Images clickable — open in VS Code's built-in image preview tab
- No collapsible sections — all content displays flat
- No container border/background — problem statement blends seamlessly into the exercise detail view
- Task/subtask markers: bold + colored text prefix (e.g., bold "Task 1:" in accent color)
- Max-width 800px maintained
- No copy button on code blocks

### Artemis Visual Alignment
- VS Code extension identity first — native VS Code conventions, theming, and patterns
- Artemis branding limited to the logo only
- Icon choices are best Lucide match independently — not trying to replicate Artemis web's specific icons
- VS Code semantic colors (`--vscode-testing-iconPassed`, `--vscode-errorForeground`) for status/accent colors

### Claude's Discretion
- Specific Lucide icon choices for each domain type (programming, quiz, modeling, etc.)
- Accessibility attributes (aria-labels, screen reader support) for icon buttons
- Animation/transition details for hover states
- Exact spacing and typography refinements
- Error state handling and loading indicators

</decisions>

<specifics>
## Specific Ideas

- PlantUML rendering should reuse the existing `PlantUmlCommandModule` and `artemisApi.renderPlantUmlToSvg()` — check old version's approach of sending PlantUML to Artemis server
- Icon mapping layer should use typed const map for autocomplete/type safety while still supporting dynamic exercise types from Artemis API
- Fullscreen panels should feel like opening a VS Code document (tab in editor area), not a modal or popup

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-ui-polish-icons*
*Context gathered: 2026-02-25*
