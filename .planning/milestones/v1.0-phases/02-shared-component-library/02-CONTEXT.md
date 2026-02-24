# Phase 2: Shared Component Library - Context

**Gathered:** 2026-02-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract 20+ existing HTML-string UI components (Button, ListItem, Container, Badge, BackLink, Dropdown, TextInput, icon buttons, etc.) into typed React components that match the current visual design. Components use VS Code CSS variables for theme compliance. ExerciseDetail and ExamExerciseDetail share components via React composition. No new visual capabilities — this is a 1:1 port with React idioms.

</domain>

<decisions>
## Implementation Decisions

### Component API style
- React-idiomatic props: use children for content, event handler props (onClick/onChange), standard React conventions
- Action handling via callback props (onClick, onAction) — components stay agnostic of VS Code messaging; calling views wire callbacks to postMessage
- Form components (TextInput, Dropdown) are controlled — parent manages value via props
- Flat props interfaces per component; compose externally rather than exposing internal subcomponents

### Styling strategy
- CSS Modules for component-specific styles (one .module.css per component, scoped class names)
- Global base.css imported once at App/entry level — provides --theme-* CSS variables everywhere
- Dynamic styles (accent colors, conditional widths) via React inline style prop
- Both light and dark VS Code themes supported from day one (--vscode-* variables ensure automatic adaptation, verify both during development)

### Composition depth
- ContainerComponent stays as a single <Container> with typed props (header, footer, toolbar as ReactNode props, body via children) — not decomposed into Card/CardHeader/CardBody
- List wrapper component (<List>) manages keyboard navigation and selection state; <ListItem> is presentational only
- Icon buttons consolidated into single <IconButton> component with named preset exports (IconButton.Close, IconButton.Checkmark, etc.) — reduces file sprawl
- Shared exercise components live in an explicit shared folder (e.g., components/exercise/) making ExerciseDetail/ExamExerciseDetail reuse discoverable

### Visual parity bar
- Visually indistinguishable: same look and behavior, DOM structure can differ from current HTML
- Fix minor visual inconsistencies (spacing, alignment) during migration rather than strictly reproducing imperfections
- Improve accessibility during migration: add proper ARIA roles, keyboard handling, focus management where currently missing

### Claude's Discretion
- CSS variable layer decision: keep --theme-* abstraction layer vs. direct --vscode-* references (recommendation: keep --theme-* for semantic clarity)
- Exact component file/folder organization within the component library
- Which accessibility improvements are worth adding per component
- Loading/empty/error state display details within components

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-shared-component-library*
*Context gathered: 2026-02-23*
