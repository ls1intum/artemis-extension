# Phase 2: Shared Component Library - Research

**Researched:** 2026-02-23
**Domain:** React component library migration (HTML string → typed React components)
**Confidence:** HIGH

## Summary

Phase 2 migrates 20+ existing HTML-string-based UI components (Button, ListItem, Container, Badge, BackLink, Dropdown, TextInput, icon buttons, etc.) into typed React components with CSS Modules, preserving exact visual design while gaining React idioms (composition, controlled components, TypeScript props). The existing codebase already has well-structured components with VS Code CSS variable theming (--vscode-* via --theme-* abstraction layer) and comprehensive styling patterns that translate cleanly to React + CSS Modules.

The migration is a **1:1 port**, not a redesign. ExerciseDetail and ExamExerciseDetail currently share 4 exercise-specific components (SubmissionStatusComponent, ParticipationActionsComponent, BuildProgressComponent, RepositoryStatusScripts), which should be consolidated into a shared folder for explicit React composition. The existing base.css provides --theme-* CSS variables that map to --vscode-* tokens, enabling automatic theme adaptation across light/dark modes.

**Primary recommendation:** Use React 18 functional components with TypeScript, CSS Modules for scoped styling, controlled component pattern for forms, composition over inheritance, and preserve the --theme-* variable abstraction layer. Install esbuild-css-modules-plugin and typescript-plugin-css-modules for CSS Modules support with type safety.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Component API style**
- React-idiomatic props: use children for content, event handler props (onClick/onChange), standard React conventions
- Action handling via callback props (onClick, onAction) — components stay agnostic of VS Code messaging; calling views wire callbacks to postMessage
- Form components (TextInput, Dropdown) are controlled — parent manages value via props
- Flat props interfaces per component; compose externally rather than exposing internal subcomponents

**Styling strategy**
- CSS Modules for component-specific styles (one .module.css per component, scoped class names)
- Global base.css imported once at App/entry level — provides --theme-* CSS variables everywhere
- Dynamic styles (accent colors, conditional widths) via React inline style prop
- Both light and dark VS Code themes supported from day one (--vscode-* variables ensure automatic adaptation, verify both during development)

**Composition depth**
- ContainerComponent stays as a single <Container> with typed props (header, footer, toolbar as ReactNode props, body via children) — not decomposed into Card/CardHeader/CardBody
- List wrapper component (<List>) manages keyboard navigation and selection state; <ListItem> is presentational only
- Icon buttons consolidated into single <IconButton> component with named preset exports (IconButton.Close, IconButton.Checkmark, etc.) — reduces file sprawl
- Shared exercise components live in an explicit shared folder (e.g., components/exercise/) making ExerciseDetail/ExamExerciseDetail reuse discoverable

**Visual parity bar**
- Visually indistinguishable: same look and behavior, DOM structure can differ from current HTML
- Fix minor visual inconsistencies (spacing, alignment) during migration rather than strictly reproducing imperfections
- Improve accessibility during migration: add proper ARIA roles, keyboard handling, focus management where currently missing

### Claude's Discretion

- CSS variable layer decision: keep --theme-* abstraction layer vs. direct --vscode-* references (recommendation: keep --theme-* for semantic clarity)
- Exact component file/folder organization within the component library
- Which accessibility improvements are worth adding per component
- Loading/empty/error state display details within components

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMP-01 | All 20+ existing UI components (Button, ListItem, Container, Badge, BackLink, etc.) are ported to React with identical visual design | Standard Stack (React 18 functional components), Architecture Patterns (component API design), Code Examples (CSS Modules + TypeScript props) |
| COMP-02 | All components use VS Code CSS variables (var(--vscode-*)) for theme compliance | Existing base.css provides --theme-* abstraction layer, CSS Modules pattern preserves CSS variable usage, both approaches documented |
| COMP-03 | ExerciseDetail and ExamExerciseDetail share components via React composition (formalizing existing ~70% code reuse) | Architecture Patterns (composition over inheritance), Recommended Project Structure (shared exercise components folder) |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI component rendering | Already installed in Phase 1, stable release with automatic batching, concurrent features, no breaking changes from React 19 |
| TypeScript | 5.x | Type safety for component props and state | Already configured in Phase 1 with jsx: react-jsx, enables intellisense and compile-time validation |
| esbuild | Latest | Bundle React components with CSS Modules | Already configured in Phase 1, fast builds, CSS Modules support via plugin |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| esbuild-css-modules-plugin | Latest | CSS Modules bundling for esbuild | Required for .module.css support in esbuild (native loader doesn't export class names to JS) |
| typescript-plugin-css-modules | Latest | TypeScript intellisense for CSS Module imports | Provides autocomplete for imported class names, prevents typos, generates .d.ts types |
| clsx | 2.x | Conditional class name composition | Optional but recommended for clean conditional styling (e.g., `clsx(styles.button, isActive && styles.active)`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS Modules | Styled Components / Emotion | CSS-in-JS adds bundle bloat (~15KB), runtime overhead, doesn't integrate with existing --vscode-* variables, decision already made in CONTEXT |
| Functional components | Class components | Classes are legacy pattern, hooks provide cleaner state/lifecycle management, decision already made (use functional) |
| --theme-* abstraction | Direct --vscode-* refs | Abstraction layer provides semantic naming and buffer for future theming changes, existing codebase already uses --theme-*, recommended to preserve |
| Controlled components | Uncontrolled components | Decision already locked in CONTEXT — form components must be controlled |

**Installation:**
```bash
cd iris-thaumantias
npm install --save-dev esbuild-css-modules-plugin typescript-plugin-css-modules clsx
```

## Architecture Patterns

### Recommended Project Structure

Based on existing codebase structure and user decisions:

```
iris-thaumantias/src/views/webview/react/
├── components/              # Shared component library
│   ├── Button/
│   │   ├── Button.tsx       # Main button component
│   │   ├── Button.module.css
│   │   ├── IconButton.tsx   # Icon button with named presets
│   │   └── index.ts         # Re-exports
│   ├── Container/
│   │   ├── Container.tsx
│   │   ├── Container.module.css
│   │   └── index.ts
│   ├── ListItem/
│   │   ├── ListItem.tsx     # Presentational only
│   │   ├── ListItem.module.css
│   │   └── index.ts
│   ├── List/
│   │   ├── List.tsx         # Keyboard nav + selection state
│   │   ├── List.module.css
│   │   └── index.ts
│   ├── Badge/
│   │   ├── Badge.tsx
│   │   ├── Badge.module.css
│   │   └── index.ts
│   ├── BackLink/
│   │   ├── BackLink.tsx
│   │   ├── BackLink.module.css
│   │   └── index.ts
│   ├── Dropdown/
│   │   ├── Dropdown.tsx     # Controlled component
│   │   ├── Dropdown.module.css
│   │   └── index.ts
│   ├── TextInput/
│   │   ├── TextInput.tsx    # Controlled component
│   │   ├── TextInput.module.css
│   │   └── index.ts
│   └── exercise/            # Shared exercise components (COMP-03)
│       ├── SubmissionStatus.tsx
│       ├── SubmissionStatus.module.css
│       ├── ParticipationActions.tsx
│       ├── ParticipationActions.module.css
│       ├── BuildProgress.tsx
│       ├── BuildProgress.module.css
│       └── index.ts
├── styles/
│   └── base.css             # Global --theme-* variables (imported in index.tsx)
├── App.tsx
├── ErrorBoundary.tsx
└── index.tsx
```

**Rationale:**
- PascalCase folders match React component naming convention
- Each component folder is self-contained (component + styles + index)
- `index.ts` re-exports enable clean imports: `import { Button } from './components/Button'`
- `components/exercise/` folder explicitly formalizes shared exercise components (addresses COMP-03)
- Global `base.css` imported once at entry point, provides --theme-* variables to all components

### Pattern 1: React Functional Component with TypeScript Props

**What:** Functional component with explicit interface for props, using children for content composition

**When to use:** All components (user decision: functional components, not classes)

**Example:**
```typescript
// Source: React official docs + TypeScript handbook
import { ReactNode } from 'react';
import styles from './Button.module.css';
import clsx from 'clsx';

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  disabled?: boolean;
  className?: string;
  fullWidth?: boolean;
  icon?: ReactNode;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
  className,
  fullWidth = false,
  icon
}: ButtonProps) {
  return (
    <button
      className={clsx(
        styles.btn,
        styles[`btn-${variant}`],
        fullWidth && styles['btn-full-width'],
        disabled && styles['btn-disabled'],
        className
      )}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {icon && <span className={styles['btn-icon']}>{icon}</span>}
      {children && <span className={styles['btn-label']}>{children}</span>}
    </button>
  );
}
```

### Pattern 2: Controlled Form Component

**What:** Form input where parent owns state, component calls onChange callback with new value

**When to use:** All form inputs (user decision: controlled components for TextInput, Dropdown)

**Example:**
```typescript
// Source: React official docs on forms
import { ChangeEvent } from 'react';
import styles from './TextInput.module.css';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'password' | 'email';
  label?: string;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  type = 'text',
  label
}: TextInputProps) {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={styles['input-wrapper']}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        type={type}
        className={styles.input}
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}
```

### Pattern 3: CSS Modules with TypeScript

**What:** Import .module.css files as typed objects, use imported class names

**When to use:** All component-specific styling (user decision: CSS Modules for scoped styles)

**Example:**
```typescript
// Source: CSS Modules + TypeScript documentation
import styles from './Container.module.css';

// TypeScript plugin generates .d.ts:
// declare const styles: {
//   readonly container: string;
//   readonly "container--highlight": string;
//   ...
// };

export function Container({ children, variant = 'default' }) {
  return (
    <div className={styles.container} data-variant={variant}>
      {children}
    </div>
  );
}
```

```css
/* Container.module.css */
.container {
  background: var(--theme-card-background);
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-container-radius);
  padding: var(--theme-container-padding);
}

.container[data-variant="highlight"] {
  border-color: var(--theme-primary-color);
}
```

### Pattern 4: Composition with children and ReactNode Props

**What:** Container components accept header/footer/toolbar as ReactNode props, body via children

**When to use:** Container, List, and other wrapper components (user decision: flat props, compose externally)

**Example:**
```typescript
// Source: React composition patterns
import { ReactNode } from 'react';
import styles from './Container.module.css';

interface ContainerProps {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  toolbar?: ReactNode;
  variant?: 'default' | 'muted' | 'highlight' | 'warning';
}

export function Container({
  children,
  header,
  footer,
  toolbar,
  variant = 'default'
}: ContainerProps) {
  return (
    <div className={styles.container} data-variant={variant}>
      {header && <div className={styles.header}>{header}</div>}
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}
```

### Pattern 5: Icon Button with Named Presets

**What:** Single IconButton component with static factory methods for common variants

**When to use:** Icon buttons (user decision: consolidate into single component, reduce file sprawl)

**Example:**
```typescript
// Source: Factory pattern + React composition
import { ReactNode } from 'react';
import styles from './IconButton.module.css';

interface IconButtonProps {
  icon: ReactNode;
  onClick?: () => void;
  ariaLabel: string;
  disabled?: boolean;
}

export function IconButton({ icon, onClick, ariaLabel, disabled }: IconButtonProps) {
  return (
    <button
      className={styles['icon-button']}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      type="button"
    >
      {icon}
    </button>
  );
}

// Named presets as static exports
IconButton.Close = ({ onClick }: { onClick?: () => void }) => (
  <IconButton icon={<CloseIcon />} onClick={onClick} ariaLabel="Close" />
);

IconButton.Checkmark = ({ onClick }: { onClick?: () => void }) => (
  <IconButton icon={<CheckmarkIcon />} onClick={onClick} ariaLabel="Confirm" />
);

IconButton.Settings = ({ onClick }: { onClick?: () => void }) => (
  <IconButton icon={<SettingsIcon />} onClick={onClick} ariaLabel="Settings" />
);
```

### Pattern 6: Dynamic Inline Styles for Runtime Values

**What:** Use inline style prop for values that can't be statically determined (accent colors, dynamic widths)

**When to use:** Accent colors, conditional dimensions, runtime-computed styles (user decision: dynamic styles via inline style prop)

**Example:**
```typescript
// Source: React inline styles documentation
interface ContainerProps {
  accentColor?: string;
  outline?: string;
  children: ReactNode;
}

export function Container({ accentColor, outline, children }: ContainerProps) {
  const inlineStyles: React.CSSProperties = {};
  if (accentColor) {
    inlineStyles['--ui-container-accent-color'] = accentColor;
  }
  if (outline) {
    inlineStyles.outline = outline;
    inlineStyles.outlineOffset = '2px';
  }

  return (
    <div className={styles.container} style={inlineStyles}>
      {children}
    </div>
  );
}
```

### Anti-Patterns to Avoid

- **Prop drilling through 3+ levels:** Use composition or context for deeply nested state, not manual prop threading through every layer
- **Mixing controlled/uncontrolled:** ALWAYS initialize form inputs with empty strings, never undefined/null (causes React controlled/uncontrolled warning)
- **Inline functions without useCallback:** For event handlers passed to child components that use React.memo, wrap with useCallback to prevent unnecessary re-renders
- **Using index as key in lists:** Use stable IDs from data, not array indices (causes bugs when list order changes)
- **Overusing useEffect:** Most state updates don't need useEffect (React 18 guidance) — only for side effects like API calls, subscriptions, external DOM manipulation
- **CSS-in-JS for this project:** Decision already made (CSS Modules), don't introduce Styled Components or Emotion
- **Over-fragmentation:** Don't create separate components for every tiny UI element; balance reusability with maintainability

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Class name composition | String concatenation with ternaries | `clsx` library | Handles undefined/null gracefully, cleaner conditional syntax, widely used pattern (2.1M weekly downloads) |
| Dropdown accessibility | Custom keyboard nav + ARIA | `<select>` or React Aria's useSelect hook | Native select handles keyboard/screen readers automatically, React Aria provides unstyled accessible primitives for custom dropdowns |
| Focus management | Manual focus tracking | React's useRef + native focus methods | React refs integrate with reconciliation, browser handles focus order automatically with proper tabindex |
| CSS variable type generation | Manual .d.ts files | typescript-plugin-css-modules | Auto-generates types on CSS file change, prevents typos, 500K+ weekly downloads |

**Key insight:** VS Code extensions should leverage native browser APIs and standard React patterns rather than custom implementations. The sandboxed webview environment has full DOM access but no npm packages at runtime, so prefer lightweight dependencies that compile away (like clsx) over runtime-heavy solutions.

## Common Pitfalls

### Pitfall 1: CSS Modules Not Exported to JavaScript

**What goes wrong:** esbuild's native `local-css` loader bundles .module.css but doesn't export class names to JS, causing `styles.buttonPrimary` to be undefined

**Why it happens:** esbuild's CSS support is designed for bundling, not for CSS Modules pattern where class names must be imported into JS

**How to avoid:** Install and configure esbuild-css-modules-plugin in esbuild.js:

```javascript
const cssModulesPlugin = require('esbuild-css-modules-plugin');

const webviewReactCtx = await esbuild.context({
  // ... other config
  plugins: [
    cssModulesPlugin(), // Add before esbuildProblemMatcherPlugin
    esbuildProblemMatcherPlugin,
  ],
});
```

**Warning signs:** Component renders but has no styling, `console.log(styles)` shows empty object or undefined

### Pitfall 2: Controlled/Uncontrolled Component Warning

**What goes wrong:** React warns "component is changing from uncontrolled to controlled" when state changes from undefined to a string

**Why it happens:** React tracks whether an input is controlled based on whether `value` prop exists on first render. If it starts undefined and later becomes a string, React treats it as switching modes.

**How to avoid:** ALWAYS initialize form state with empty strings:

```typescript
// BAD
const [email, setEmail] = useState<string>(); // undefined initially

// GOOD
const [email, setEmail] = useState<string>(''); // empty string initially
```

**Warning signs:** Console warning "component is changing from uncontrolled to controlled component", input behaves unpredictably

### Pitfall 3: VS Code CSS Variables Don't Update on Theme Change

**What goes wrong:** Component uses hardcoded colors instead of CSS variables, doesn't adapt when user switches light/dark theme

**Why it happens:** Developer copies hex color values from devtools instead of using var(--vscode-*) or var(--theme-*) variables

**How to avoid:**
- ALWAYS use CSS variables, never hardcoded colors
- Prefer --theme-* abstraction layer (semantic names) over direct --vscode-* references
- Test both light and dark themes during development (VS Code: Preferences > Theme)

**Warning signs:** Component looks correct in one theme but wrong in the other, colors don't match VS Code's native UI

### Pitfall 4: Excessive Re-renders from Inline Function Props

**What goes wrong:** Child component re-renders on every parent render even when props haven't changed

**Why it happens:** Inline arrow functions in JSX create new function references on every render, breaking React.memo optimization

**How to avoid:** Use useCallback for handlers passed to memoized children:

```typescript
// BAD - creates new function on every render
<Button onClick={() => handleClick(id)}>Click</Button>

// GOOD - memoized function reference
const handleClick = useCallback(() => {
  handleClick(id);
}, [id]);

<Button onClick={handleClick}>Click</Button>
```

**Warning signs:** Profiler shows component re-rendering when parent updates but its props haven't changed

### Pitfall 5: TypeScript Can't Find CSS Module Types

**What goes wrong:** TypeScript errors "Cannot find module './Button.module.css'" even though file exists

**Why it happens:** TypeScript doesn't know how to handle .css imports without type definitions

**How to avoid:** Add typescript-plugin-css-modules to tsconfig.json:

```json
{
  "compilerOptions": {
    "plugins": [
      { "name": "typescript-plugin-css-modules" }
    ]
  }
}
```

Or create global type declaration:

```typescript
// src/types/css-modules.d.ts
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
```

**Warning signs:** Red squiggles in VSCode on CSS Module imports, build succeeds but editor shows errors

### Pitfall 6: Losing Existing Keyboard Navigation

**What goes wrong:** Migrated components lose keyboard accessibility that existed in HTML versions (e.g., arrow key navigation in lists)

**Why it happens:** Original HTML components had inline JS for keyboard handling (ListItemComponent.generateScript()), easy to forget during React migration

**How to avoid:**
- Audit existing component scripts for keyboard event listeners
- Port keyboard handling to React event handlers (onKeyDown)
- Test all components with keyboard-only navigation
- Add ARIA attributes (role, aria-label, tabindex) where missing

**Warning signs:** Original component responds to arrow keys/Enter/Space, React version doesn't; users report accessibility regression

## Code Examples

Verified patterns from existing codebase and official sources:

### Migrating HTML String Component to React

**Original (HTML string generation):**
```typescript
// buttonComponent.ts
export class ButtonComponent {
  public static generate(options: ButtonOptions): string {
    const { label, icon, variant = 'primary', onClick } = options;
    return `
      <button class="btn btn-${variant}" onclick="${onClick}">
        ${icon ? `<span class="btn-icon">${icon}</span>` : ''}
        ${label}
      </button>
    `;
  }
}
```

**Migrated (React + TypeScript + CSS Modules):**
```typescript
// Button.tsx
import { ReactNode } from 'react';
import styles from './Button.module.css';
import clsx from 'clsx';

interface ButtonProps {
  children: ReactNode;
  icon?: ReactNode;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  onClick?: () => void;
  disabled?: boolean;
}

export function Button({
  children,
  icon,
  variant = 'primary',
  onClick,
  disabled = false
}: ButtonProps) {
  return (
    <button
      className={clsx(
        styles.btn,
        styles[`btn-${variant}`],
        disabled && styles['btn-disabled']
      )}
      onClick={onClick}
      disabled={disabled}
      type="button"
    >
      {icon && <span className={styles['btn-icon']}>{icon}</span>}
      {children}
    </button>
  );
}
```

**Key changes:**
- HTML string → JSX
- onclick="command" → onClick={callback}
- Static class method → functional component
- Inline interpolation → children prop
- Class name string concat → clsx() for conditional classes
- button.css → Button.module.css with imported styles object

### Container with Composition

**Original (HTML string with config object):**
```typescript
// containerComponent.ts
ContainerComponent.generate({
  header: { title: 'Exercise', badge: '5' },
  bodyHtml: '<p>Content here</p>',
  footerHtml: '<button>Action</button>'
});
```

**Migrated (React composition):**
```typescript
// Usage in parent component
<Container
  header={
    <div>
      <h3>Exercise</h3>
      <Badge>5</Badge>
    </div>
  }
  footer={<Button>Action</Button>}
>
  <p>Content here</p>
</Container>
```

**Key changes:**
- String HTML → React elements
- Config object with HTML strings → ReactNode props
- bodyHtml → children prop
- Caller composes structure instead of passing config

### Controlled Dropdown Component

**Original (generates HTML with inline onchange):**
```typescript
// dropdownComponent.ts
DropdownComponent.generate({
  options: ['Option 1', 'Option 2'],
  onchange: 'handleChange(this.value)'
});
```

**Migrated (controlled React component):**
```typescript
// Dropdown.tsx
interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  disabled?: boolean;
}

export function Dropdown({ value, onChange, options, disabled }: DropdownProps) {
  return (
    <select
      className={styles.dropdown}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// Usage in parent:
function ParentComponent() {
  const [selected, setSelected] = useState('');
  return (
    <Dropdown
      value={selected}
      onChange={setSelected}
      options={[
        { label: 'Option 1', value: 'opt1' },
        { label: 'Option 2', value: 'opt2' }
      ]}
    />
  );
}
```

**Key changes:**
- Parent owns state (controlled pattern)
- onChange passes value directly, not event string
- Options array typed explicitly
- key prop for list rendering

### List with Keyboard Navigation

**Original (HTML + inline script for keyboard handling):**
```typescript
// listItemComponent.ts
ListItemComponent.generateScript(): string {
  return `
    document.addEventListener('keydown', function(event) {
      if (event.key === 'ArrowDown') { /* navigate */ }
    });
  `;
}
```

**Migrated (React with hooks):**
```typescript
// List.tsx
import { useState, useRef, KeyboardEvent, Children, cloneElement } from 'react';
import styles from './List.module.css';

interface ListProps {
  children: ReactNode;
  onSelect?: (index: number) => void;
}

export function List({ children, onSelect }: ListProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const listRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: KeyboardEvent) => {
    const childCount = Children.count(children);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (selectedIndex + 1) % childCount;
      setSelectedIndex(nextIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (selectedIndex - 1 + childCount) % childCount;
      setSelectedIndex(prevIndex);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(selectedIndex);
    }
  };

  return (
    <div
      ref={listRef}
      className={styles.list}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="listbox"
      aria-activedescendant={`list-item-${selectedIndex}`}
    >
      {Children.map(children, (child, index) =>
        cloneElement(child as ReactElement, {
          selected: index === selectedIndex,
          id: `list-item-${index}`
        })
      )}
    </div>
  );
}
```

**Key changes:**
- Inline script → React hooks (useState, useRef)
- Global event listener → component-scoped onKeyDown
- DOM query for items → Children.map + cloneElement
- ARIA attributes added for accessibility

### CSS Modules with CSS Variables

```css
/* Button.module.css */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 4px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.btn-primary {
  background-color: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
}

.btn-primary:hover {
  background-color: var(--vscode-button-hoverBackground);
}

.btn-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
```

**Key points:**
- CSS Modules scoping (.btn becomes .Button_btn_a3f2c8)
- var(--vscode-*) variables still work (global scope)
- Can also use var(--theme-*) from base.css
- Kebab-case class names require bracket notation in TypeScript: `styles['btn-primary']`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Class components with lifecycle methods | Functional components with hooks | React 16.8 (2019) | Simpler code, better composition, easier testing |
| Manual React imports in every file | Automatic JSX transform | React 17 (2020) | Cleaner code, smaller bundles, already configured in Phase 1 |
| Prop types runtime validation | TypeScript static types | Industry shift 2018+ | Compile-time errors, better intellisense, no runtime cost |
| CSS-in-JS (Styled Components, Emotion) | CSS Modules / native CSS | Trend reversal 2023+ | Better performance, simpler tooling, smaller bundles, no SSR issues |
| Uncontrolled forms with refs | Controlled components with state | Best practice since 2016 | Predictable state, easier validation, single source of truth |

**Deprecated/outdated:**
- **ReactDOM.render()**: Replaced by createRoot() in React 18 (already using in Phase 1)
- **String refs**: Use useRef() hook instead
- **UNSAFE_* lifecycle methods**: Not applicable (using functional components)
- **defaultProps**: Deprecated in React 19, use default parameter values in destructuring instead

## Open Questions

1. **Icon SVG Handling Strategy**
   - What we know: Current codebase uses IconDefinitions.getIcon() to return SVG strings, inserted via dangerouslySetInnerHTML or direct string interpolation
   - What's unclear: Best pattern for React (inline SVG components vs. icon library vs. sprite sheet vs. dangerouslySetInnerHTML)
   - Recommendation: Create IconDefinitions as React components (IconDefinitions.Check, IconDefinitions.Close, etc.) returning JSX SVG elements. Cleaner than dangerouslySetInnerHTML, enables props like size/color, type-safe usage. Low migration effort since SVGs already extracted.

2. **CSS Variable Layer Naming Convention**
   - What we know: Existing base.css uses --theme-* variables that map to --vscode-*, providing semantic abstraction layer
   - What's unclear: Whether to preserve --theme-* in new components or switch to direct --vscode-* references
   - Recommendation: Keep --theme-* abstraction. Benefits: semantic naming (--theme-primary-color clearer than --vscode-focusBorder), buffer for future theming changes, consistency with existing codebase. Low cost (variables already defined).

3. **Component Export Pattern**
   - What we know: Need to export 20+ components for use in views
   - What's unclear: Named exports from each component file vs. barrel exports from index.ts files
   - Recommendation: Both. Each component exports named component (`export function Button`), component folder has index.ts re-exporting (`export { Button } from './Button'`). Enables clean imports (`from 'components/Button'`) while maintaining explicit exports. Standard pattern in React libraries.

## Validation Architecture

> Note: Validation section included because workflow.nyquist_validation is not set (defaults to true in GSD workflow)

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None detected — Wave 0 gap |
| Config file | None — must be created in Wave 0 |
| Quick run command | TBD based on framework choice (recommendation: Vitest) |
| Full suite command | TBD based on framework choice |
| Estimated runtime | TBD (target: < 30 seconds for component unit tests) |

**Recommendation:** Install Vitest for React component testing (fast, native ESM, React Testing Library integration). Alternative: Jest (slower but more mature ecosystem).

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-01 | All components render without errors | unit | `vitest run src/views/webview/react/components/**/*.test.tsx` | ❌ Wave 0 gap |
| COMP-01 | Button variants render correct classes | unit | `vitest run src/views/webview/react/components/Button/Button.test.tsx` | ❌ Wave 0 gap |
| COMP-01 | Container composition renders header/footer/children | unit | `vitest run src/views/webview/react/components/Container/Container.test.tsx` | ❌ Wave 0 gap |
| COMP-02 | Components apply VS Code CSS variables | unit | `vitest run src/views/webview/react/components/**/*.test.tsx` | ❌ Wave 0 gap |
| COMP-02 | Theme switching updates component colors | manual-only | Visual inspection in light/dark themes | ❌ manual only |
| COMP-03 | Exercise components render in both ExerciseDetail and ExamExerciseDetail | integration | `vitest run src/views/webview/react/views/**/*.test.tsx` | ❌ Wave 0 gap |

**Notes on test types:**
- **unit**: Isolated component rendering tests (fast, < 1s per component)
- **integration**: Tests component composition in real view contexts
- **manual-only**: Theme switching requires human visual verification (automated tests can check CSS variable application, not visual correctness)

### Nyquist Sampling Rate

- **Minimum sample interval:** After every committed task → run quick unit tests for affected components
- **Full suite trigger:** Before merging final task of any plan wave
- **Phase-complete gate:** All component tests green + manual theme verification before `/gsd:verify-work`
- **Estimated feedback latency per task:** ~5-10 seconds (Vitest is fast for component tests)

### Wave 0 Gaps (must be created before implementation)

- [ ] `vitest.config.ts` — Configure Vitest for React + TypeScript + CSS Modules
- [ ] `src/views/webview/react/test/setup.ts` — Test utilities, mock vscodeApi, custom matchers
- [ ] `src/views/webview/react/components/Button/Button.test.tsx` — Unit tests for Button variants, events, disabled state
- [ ] `src/views/webview/react/components/Container/Container.test.tsx` — Tests for composition, variants, dynamic styles
- [ ] `src/views/webview/react/components/TextInput/TextInput.test.tsx` — Controlled component tests (value, onChange)
- [ ] `src/views/webview/react/components/List/List.test.tsx` — Keyboard navigation tests (arrow keys, Enter, Space)
- [ ] Install test dependencies: `npm install --save-dev vitest @testing-library/react @testing-library/user-event jsdom`

**If no test infrastructure exists**, must be created before component implementation to enable Nyquist validation (test-after-every-commit).

## Sources

### Primary (HIGH confidence)

- [React 18.3.1 Official Documentation](https://react.dev) - Component patterns, hooks, controlled components, composition
- [TypeScript 5.x Handbook](https://www.typescriptlang.org/docs/handbook/) - React TypeScript patterns
- [CSS Modules GitHub](https://github.com/css-modules/css-modules) - CSS Modules specification
- Existing codebase - buttonComponent.ts, listItemComponent.ts, containerComponent.ts, base.css verified by reading source files

### Secondary (MEDIUM confidence)

- [Using React in Visual Studio Code Webviews - Ken Muse](https://www.kenmuse.com/blog/using-react-in-vs-code-webviews/) - VS Code webview + React patterns
- [Composition vs Inheritance – React](https://legacy.reactjs.org/docs/composition-vs-inheritance.html) - React composition best practices
- [React Accessibility – React](https://legacy.reactjs.org/docs/accessibility.html) - ARIA roles, keyboard navigation, focus management
- [How to set up CSS Modules with esbuild - DEV Community](https://dev.to/marcinwosinek/how-to-set-up-css-modules-with-esbuild-260g) - esbuild CSS Modules configuration
- [esbuild-css-modules-plugin npm](https://www.npmjs.com/package/esbuild-css-modules-plugin) - Plugin documentation
- [typescript-plugin-css-modules npm](https://www.npmjs.com/package/typescript-plugin-css-modules) - TypeScript CSS Modules intellisense

### Tertiary (LOW confidence - marked for validation)

- [Common React Mistakes to Avoid - 42works](https://42works.net/most-common-react-mistakes-how-to-fix-them/) - Pitfalls guidance (useEffect overuse, prop drilling)
- [React Component Libraries in 2026 - Medium](https://yakhil25.medium.com/react-component-libraries-in-2026-the-definitive-guide-to-choosing-your-stack-fa7ae0368077) - Current state of React ecosystem

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React 18.3.1 already installed (Phase 1), CSS Modules well-documented, esbuild plugins verified in npm
- Architecture: HIGH - Existing component structure analyzed, React patterns from official docs, user decisions lock key choices
- Pitfalls: MEDIUM - Common issues documented across web sources, specific to React 18 + CSS Modules + VS Code webview context
- Validation: LOW - No existing test infrastructure detected, framework recommendation based on current trends

**Research date:** 2026-02-23
**Valid until:** 2026-04-23 (60 days - stable ecosystem, React 18 mature, no breaking changes expected)
