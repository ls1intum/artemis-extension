# Phase 2: Shared Component Library - Research

**Researched:** 2026-02-23
**Domain:** React component library migration from HTML string templates
**Confidence:** HIGH

## Summary

Phase 2 involves extracting 20+ existing HTML-string UI components (Button, ListItem, Container, Badge, BackLink, Dropdown, TextInput, icon buttons, etc.) into typed React components. The existing codebase has well-structured TypeScript component classes that generate HTML strings with comprehensive styling via VS Code CSS variables. The migration path is clear: convert HTML generation to JSX, preserve the existing CSS files, maintain visual parity, and formalize the ~70% code sharing between ExerciseDetail and ExamExerciseDetail views through React composition.

**Primary recommendation:** Use CSS Modules with esbuild's native local-css loader, maintain the existing --theme-* CSS variable abstraction layer, and structure components with flat props interfaces that delegate composition to parent components. Controlled form components, TypeScript discriminated unions for variants, and React.memo for expensive list items will preserve performance while enabling incremental view migration in Phase 3+.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Component API style:**
- React-idiomatic props: use children for content, event handler props (onClick/onChange), standard React conventions
- Action handling via callback props (onClick, onAction) — components stay agnostic of VS Code messaging; calling views wire callbacks to postMessage
- Form components (TextInput, Dropdown) are controlled — parent manages value via props
- Flat props interfaces per component; compose externally rather than exposing internal subcomponents

**Styling strategy:**
- CSS Modules for component-specific styles (one .module.css per component, scoped class names)
- Global base.css imported once at App/entry level — provides --theme-* CSS variables everywhere
- Dynamic styles (accent colors, conditional widths) via React inline style prop
- Both light and dark VS Code themes supported from day one (--vscode-* variables ensure automatic adaptation, verify both during development)

**Composition depth:**
- ContainerComponent stays as a single <Container> with typed props (header, footer, toolbar as ReactNode props, body via children) — not decomposed into Card/CardHeader/CardBody
- List wrapper component (<List>) manages keyboard navigation and selection state; <ListItem> is presentational only
- Icon buttons consolidated into single <IconButton> component with named preset exports (IconButton.Close, IconButton.Checkmark, etc.) — reduces file sprawl
- Shared exercise components live in an explicit shared folder (e.g., components/exercise/) making ExerciseDetail/ExamExerciseDetail reuse discoverable

**Visual parity bar:**
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
| COMP-01 | All 20+ existing UI components (Button, ListItem, Container, Badge, BackLink, etc.) are ported to React with identical visual design | Standard Stack (React 18.3.1, CSS Modules), Architecture Patterns (HTML-to-JSX conversion), Code Examples (component props interface patterns) |
| COMP-02 | All components use VS Code CSS variables (`var(--vscode-*)`) for theme compliance | Standard Stack (esbuild native CSS Modules), Architecture Patterns (--theme-* abstraction layer), existing base.css provides proven pattern |
| COMP-03 | ExerciseDetail and ExamExerciseDetail share components via React composition (formalizing existing ~70% code reuse) | Architecture Patterns (composition via children/ReactNode props, shared folder structure), Code Examples (Container with header/footer/body composition) |

</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 18.3.1 | UI component library | Already installed in Phase 1, industry standard for component composition, automatic JSX transform enabled (react-jsx) |
| TypeScript | 5.9.3 | Type safety | Already configured, discriminated unions for variants, strict prop typing |
| CSS Modules | Native (esbuild) | Component-scoped styling | esbuild has built-in local-css loader for .module.css files, zero-config integration |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| esbuild | 0.27.2 | Build bundler | Already configured for React, native CSS Modules support via local-css loader, no plugin needed for basic use |
| @types/react | 18.3 | React TypeScript definitions | Component props typing, ReactNode for composition |
| @types/react-dom | 18.3 | ReactDOM TypeScript definitions | Already installed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS Modules | Styled Components / Emotion | CSS-in-JS adds bundle bloat (~20-40KB), no benefit over VS Code CSS variables, rejected per REQUIREMENTS.md |
| CSS Modules | Tailwind CSS | Requires additional build config, utility-first conflicts with existing semantic class names, not worth migration cost |
| esbuild CSS Modules | webpack + css-loader | Slower build times, heavier config, no benefit when esbuild already handles it natively |

**Installation:**
```bash
# Already installed in Phase 1
npm install react@18.3.1 react-dom@18.3.1
npm install --save-dev @types/react@18.3 @types/react-dom@18.3
```

**esbuild CSS Modules configuration:**
```javascript
// Already in esbuild.js — native support via local-css loader
// .module.css files automatically get scoped class names
// No plugin needed for basic use
```

## Architecture Patterns

### Recommended Project Structure

```
src/views/webview/react/
├── components/              # Shared component library
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.module.css
│   │   └── index.ts
│   ├── Container/
│   │   ├── Container.tsx
│   │   ├── Container.module.css
│   │   └── index.ts
│   ├── ListItem/
│   │   ├── ListItem.tsx
│   │   ├── ListItem.module.css
│   │   └── index.ts
│   ├── IconButton/
│   │   ├── IconButton.tsx
│   │   ├── IconButton.module.css
│   │   ├── presets.ts        # Named exports: IconButton.Close, etc.
│   │   └── index.ts
│   ├── exercise/             # Shared exercise components
│   │   ├── ExerciseHeader/
│   │   ├── ParticipationActions/
│   │   └── SubmissionStatus/
│   └── index.ts              # Barrel export
├── App.tsx
├── ErrorBoundary.tsx
└── index.tsx
```

**Alternative considered:** Flat components/ folder with no subfolders per component. **Rejected** because colocating .tsx and .module.css files aids discoverability and matches existing project structure conventions.

### Pattern 1: HTML String to React Component

**What:** Convert existing HTML generation methods to React components with TypeScript props

**When to use:** Every component migration in this phase

**Example:**
```typescript
// BEFORE (HTML string generation)
export class ButtonComponent {
  public static generate(options: ButtonOptions): string {
    const { label, icon, variant = 'primary', command, disabled } = options;
    const classes = ['btn', `btn-${variant}`, disabled ? 'btn-disabled' : ''].filter(Boolean).join(' ');
    return `<button class="${classes}" onclick="${command}">${icon}${label}</button>`;
  }
}

// AFTER (React component)
import styles from './Button.module.css';

interface ButtonProps {
  label?: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function Button({
  label,
  icon,
  variant = 'primary',
  onClick,
  disabled = false,
  className
}: ButtonProps) {
  return (
    <button
      className={`${styles.btn} ${styles[`btn-${variant}`]} ${disabled ? styles['btn-disabled'] : ''} ${className || ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <span className={styles['btn-icon']}>{icon}</span>}
      {label && <span className={styles['btn-label']}>{label}</span>}
    </button>
  );
}
```

**Key conversions:**
1. `onclick="command"` → `onClick={onClick}` (callback prop)
2. String interpolation → JSX elements
3. Class string concatenation → className expression
4. HTML escaping → automatic in JSX
5. Static method → function component
6. Inline SVG strings → React components or ReactNode props

### Pattern 2: Controlled Form Components

**What:** Form inputs where parent component owns state via value/onChange props

**When to use:** TextInput, Dropdown, and any form element per user constraints

**Example:**
```typescript
// TextInput component (controlled)
interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
}

export function TextInput({ value, onChange, placeholder, disabled, label }: TextInputProps) {
  return (
    <div className={styles['input-group']}>
      {label && <label className={styles['input-label']}>{label}</label>}
      <input
        type="text"
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

// Parent view usage
function ExerciseView() {
  const [commitMessage, setCommitMessage] = useState('');

  return (
    <TextInput
      value={commitMessage}
      onChange={setCommitMessage}
      placeholder="Enter commit message"
    />
  );
}
```

**Why controlled:** Parent needs access to input value for validation, submission, or coordinating with other form fields. Matches React conventions and user requirements.

**Sources:**
- [Controlled vs Uncontrolled Components in React](https://certificates.dev/blog/controlled-vs-uncontrolled-components-in-react)
- [React: Controlled vs Uncontrolled Components](https://pieces.app/blog/controlled-vs-uncontrolled-components-in-react)

### Pattern 3: Composition via Children and ReactNode Props

**What:** Components accept content via children prop or typed ReactNode props for named slots

**When to use:** Container, List, and any component with flexible content areas

**Example:**
```typescript
// Container with named slots
interface ContainerProps {
  children: React.ReactNode;  // Body content
  header?: {
    title?: string;
    subtitle?: string;
    icon?: React.ReactNode;
    actions?: React.ReactNode;
  };
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  variant?: 'default' | 'muted' | 'highlight' | 'warning';
  className?: string;
}

export function Container({ children, header, toolbar, footer, variant = 'default', className }: ContainerProps) {
  return (
    <div className={`${styles.container} ${styles[`container-${variant}`]} ${className || ''}`}>
      {header && (
        <div className={styles.header}>
          {header.icon && <span className={styles.icon}>{header.icon}</span>}
          <div className={styles['title-wrap']}>
            {header.title && <h3 className={styles.title}>{header.title}</h3>}
            {header.subtitle && <p className={styles.subtitle}>{header.subtitle}</p>}
          </div>
          {header.actions && <div className={styles.actions}>{header.actions}</div>}
        </div>
      )}
      {toolbar && <div className={styles.toolbar}>{toolbar}</div>}
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </div>
  );
}

// Usage - compose externally
<Container
  header={{
    title: "Exercise Details",
    actions: <Button variant="secondary" label="Reload" onClick={handleReload} />
  }}
  toolbar={<ExerciseFilters />}
  footer={<ExerciseActions onSubmit={handleSubmit} />}
>
  <ExerciseDescription />
  <ExerciseStatus />
</Container>
```

**Why this pattern:** Flat props interface keeps Container as single component (no Card/CardHeader/CardBody decomposition per user constraints), while ReactNode props provide type-safe composition slots. Parent views control layout and can pass any React elements.

**Sources:**
- [Mastering React's Children Props: A Reusable Components](https://mernstackdev.com/mastering-reacts-children-props/)
- [React children composition patterns with TypeScript](https://medium.com/@martin_hotell/react-children-composition-patterns-with-typescript-56dfc8923c64)

### Pattern 4: CSS Modules + VS Code Theme Variables

**What:** Component-scoped CSS classes that reference global --theme-* and --vscode-* CSS variables

**When to use:** Every component per user styling strategy

**Example:**
```css
/* Button.module.css */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  cursor: pointer;
}

.btn-primary {
  background-color: var(--theme-button-background);
  color: var(--theme-button-foreground);
}

.btn-primary:hover:not(.btn-disabled) {
  background-color: var(--theme-button-hover-background);
}

.btn-disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
```

```typescript
// Button.tsx
import styles from './Button.module.css';

export function Button({ variant = 'primary', disabled, ...props }: ButtonProps) {
  return (
    <button
      className={`${styles.btn} ${styles[`btn-${variant}`]} ${disabled ? styles['btn-disabled'] : ''}`}
      disabled={disabled}
      {...props}
    />
  );
}
```

**Why this pattern:**
- CSS Modules provide scoped class names (e.g., `.btn` becomes `.Button_btn_xyz123`) preventing global conflicts
- --theme-* and --vscode-* variables ensure automatic light/dark theme adaptation
- Existing CSS files can be renamed .css → .module.css with minimal changes
- esbuild's native local-css loader handles .module.css without plugins

**Keep --theme-* abstraction layer:** Recommended. Provides semantic naming (--theme-button-background vs --vscode-button-background) and allows project-wide theme customization in base.css if needed. Only ~5% overhead in base.css variable definitions.

**Sources:**
- [React & CSS in 2026: Best Styling Approaches Compared](https://medium.com/@imranmsa93/react-css-in-2026-best-styling-approaches-compared-d5e99a771753)
- [Use CSS Modules instead of inlining styles in React](https://swarup-karavadi.medium.com/use-css-modules-instead-of-inlining-styles-in-react-fea247b97431)

### Pattern 5: Icon Button Consolidation with Named Exports

**What:** Single IconButton component with preset configurations exported as named variants

**When to use:** Replacing individual icon button files (closeButton.ts, checkmarkButton.ts, etc.)

**Example:**
```typescript
// IconButton/IconButton.tsx
import styles from './IconButton.module.css';

interface IconButtonProps {
  icon: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export function IconButton({ icon, onClick, disabled, title, className }: IconButtonProps) {
  return (
    <button
      className={`${styles['icon-btn']} ${className || ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      {icon}
    </button>
  );
}

// IconButton/presets.tsx
import { IconButton } from './IconButton';

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const CheckmarkIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M13 4L6 11L3 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

export const Close = (props: Omit<IconButtonProps, 'icon'>) => (
  <IconButton icon={<CloseIcon />} title="Close" {...props} />
);

export const Checkmark = (props: Omit<IconButtonProps, 'icon'>) => (
  <IconButton icon={<CheckmarkIcon />} title="Confirm" {...props} />
);

// IconButton/index.ts
export { IconButton } from './IconButton';
export * as IconButton from './presets';

// Usage
import { IconButton } from '@/components';

<IconButton.Close onClick={handleClose} />
<IconButton.Checkmark onClick={handleConfirm} />
```

**Why this pattern:** Reduces 7+ separate icon button files to 1 component + 1 presets file. Named exports (IconButton.Close) provide discoverable API while sharing common button logic. Matches user constraint for file sprawl reduction.

### Pattern 6: List with Keyboard Navigation

**What:** List wrapper manages keyboard nav and selection state, ListItem is presentational

**When to use:** Course list, exercise list, any navigable list per user constraints

**Example:**
```typescript
// List/List.tsx
interface ListProps<T> {
  items: T[];
  selectedId?: string;
  onSelect?: (item: T) => void;
  renderItem: (item: T, isSelected: boolean) => React.ReactNode;
  className?: string;
}

export function List<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  renderItem,
  className
}: ListProps<T>) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (focusedIndex + 1) % items.length;
      setFocusedIndex(nextIndex);
      itemRefs.current[nextIndex]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (focusedIndex - 1 + items.length) % items.length;
      setFocusedIndex(prevIndex);
      itemRefs.current[prevIndex]?.focus();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(items[focusedIndex]);
    }
  };

  return (
    <div className={`${styles.list} ${className || ''}`} onKeyDown={handleKeyDown}>
      {items.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => (itemRefs.current[index] = el)}
          tabIndex={0}
          onClick={() => onSelect?.(item)}
        >
          {renderItem(item, item.id === selectedId)}
        </div>
      ))}
    </div>
  );
}

// ListItem/ListItem.tsx (presentational only)
interface ListItemProps {
  children: React.ReactNode;
  selected?: boolean;
  highlighted?: boolean;
  className?: string;
}

export function ListItem({ children, selected, highlighted, className }: ListItemProps) {
  return (
    <div className={`
      ${styles['list-item']}
      ${selected ? styles['list-item-selected'] : ''}
      ${highlighted ? styles['list-item-highlighted'] : ''}
      ${className || ''}
    `}>
      {children}
    </div>
  );
}

// Usage
<List
  items={courses}
  selectedId={selectedCourseId}
  onSelect={handleSelectCourse}
  renderItem={(course, isSelected) => (
    <ListItem selected={isSelected} highlighted={course.isActive}>
      <CourseCard course={course} />
    </ListItem>
  )}
/>
```

**Why this pattern:** Separation of concerns — List handles navigation/selection state, ListItem handles presentation. Keyboard navigation (arrow keys, Enter) works automatically for all lists. Matches user constraint for List wrapper managing state.

**Sources:**
- [React Accessibility: Complete Guide for Developers](https://www.browserstack.com/guide/react-accessibility)
- [Accessibility – React Aria](https://react-spectrum.adobe.com/react-aria/accessibility.html)

### Anti-Patterns to Avoid

- **Don't use dangerouslySetInnerHTML for HTML strings**: Security risk, loses React benefits. Convert to JSX instead.
- **Don't mix controlled and uncontrolled inputs**: Causes "controlled vs uncontrolled" React warning. Always use controlled (value + onChange) per user requirements.
- **Don't replicate HTML structure exactly**: Focus on visual parity, not DOM structure parity. React idioms > HTML string translation.
- **Don't use inline styles for theming**: Use CSS Modules with CSS variables instead. Inline styles only for truly dynamic values (accent colors, conditional widths per user constraints).
- **Don't create subcomponents for Container**: Keep as single component with typed props per user constraints. Decomposition happens at view level, not component level.

**Sources:**
- [Converting static HTML/CSS site to React App](https://dev.to/menard_codes/converting-static-html-css-site-to-react-app-263e)
- [Strategy and Tips for Migrating to React](https://brainhub.eu/library/migrating-to-react)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSS Modules type definitions | Manual .d.ts files for every .module.css | esbuild's built-in local-css loader | Native support, zero config, auto-scoped class names |
| Keyboard navigation for lists | Custom focus management, event handling from scratch | React Aria hooks (useListBox, useOption) or simpler focus trap patterns | WAI-ARIA compliant, handles edge cases (circular navigation, disabled items, screen readers) |
| Icon component library | SVG-to-React conversion script | Use existing inline SVG strings as ReactNode props | Existing icons already optimized, no build step needed |
| Form validation library | Custom validation logic per component | Keep validation at view level for now | Phase 2 is component library only, view-level validation comes in Phase 3+ |
| State management for components | Complex useState/useReducer in components | Keep components stateless, views manage state | Components are presentational per Phase 2 scope, state management is Phase 4 (Zustand) |

**Key insight:** This phase is about porting visual components, not building a design system framework. Use esbuild's native features, keep components simple and stateless, and defer advanced patterns (React Aria, form libraries) to later phases when view migration needs them.

## Common Pitfalls

### Pitfall 1: CSS Modules Class Name Construction Errors

**What goes wrong:** Dynamic class names like `styles[\`btn-\${variant}\`]` fail silently or produce undefined values

**Why it happens:** CSS Modules exports are objects where keys must be valid JS identifiers or accessed via bracket notation. Kebab-case class names (btn-primary) must use bracket notation.

**How to avoid:**
```typescript
// WRONG - template literal in bracket notation
className={styles[`btn-${variant}`]}

// RIGHT - use bracket notation with string concatenation
className={styles['btn-' + variant]}

// ALTERNATIVE - use object lookup
const variantClasses = {
  primary: styles['btn-primary'],
  secondary: styles['btn-secondary']
};
className={variantClasses[variant]}
```

**Warning signs:** Component renders with missing styles in browser, className is undefined or empty string

**Sources:**
- [How to write type-safe CSS Modules](https://blog.logrocket.com/write-type-safe-css-modules/)

### Pitfall 2: Controlled Input Switching to Uncontrolled

**What goes wrong:** React warning: "A component is changing an uncontrolled input to be controlled" or vice versa

**Why it happens:** Input value prop switches between undefined and string, or onChange handler not provided

**How to avoid:**
```typescript
// WRONG - value can be undefined
<input value={someState} onChange={handleChange} />

// RIGHT - initialize state with empty string, not undefined
const [value, setValue] = useState('');
<input value={value} onChange={(e) => setValue(e.target.value)} />

// WRONG - missing onChange
<input value={value} />

// RIGHT - always pair value with onChange
<input value={value} onChange={(e) => setValue(e.target.value)} />
```

**Warning signs:** Console warning about controlled/uncontrolled, input behavior is erratic (doesn't update or updates unexpectedly)

**Sources:**
- [How to Fix "Controlled vs Uncontrolled" Input Warnings](https://oneuptime.com/blog/post/2026-01-24-fix-controlled-uncontrolled-input-warnings/view)

### Pitfall 3: Inline Event Handlers in JSX Causing Re-renders

**What goes wrong:** Component re-renders excessively, performance degrades in lists

**Why it happens:** Arrow functions in JSX create new function instances on every render, breaking React.memo optimization

**How to avoid:**
```typescript
// WRONG - creates new function on every render
<Button onClick={() => handleClick(item.id)} />

// RIGHT - use useCallback for functions created in render
const handleItemClick = useCallback(() => handleClick(item.id), [item.id]);
<Button onClick={handleItemClick} />

// ALTERNATIVE - for list items, pass ID and handle in parent
<Button onClick={handleClick} data-id={item.id} />
// Then in handler: const id = e.currentTarget.dataset.id;
```

**Warning signs:** List scrolling is janky, React DevTools Profiler shows high render counts for list items, keyboard navigation lags

**Sources:**
- [React & CSS in 2026: Best Styling Approaches Compared](https://medium.com/@imranmsa93/react-css-in-2026-best-styling-approaches-compared-d5e99a771753)

### Pitfall 4: CSS Modules Import Path Confusion

**What goes wrong:** CSS Module imports fail with "module not found" even though .module.css file exists

**Why it happens:** Incorrect relative paths, missing file extension, or esbuild config issue

**How to avoid:**
```typescript
// WRONG - missing .module.css extension
import styles from './Button';

// WRONG - incorrect relative path
import styles from '../Button.module.css'; // when file is in same dir

// RIGHT - correct relative path with extension
import styles from './Button.module.css';

// esbuild.js - verify no loader override for .module.css
// (Native local-css loader should handle it automatically)
```

**Warning signs:** Build fails with module resolution error, styles object is undefined at runtime

**Sources:**
- [How to set up CSS Modules with esbuild](https://how-to.dev/how-to-set-up-css-modules-with-esbuild)

### Pitfall 5: Forgetting ARIA Attributes When Adding Keyboard Navigation

**What goes wrong:** Keyboard navigation works but screen readers don't announce state changes or interactive elements

**Why it happens:** Keyboard events added without corresponding ARIA roles, labels, or state attributes

**How to avoid:**
```typescript
// WRONG - keyboard nav without ARIA
<div onClick={handleClick} onKeyDown={handleKeyDown}>
  {item.name}
</div>

// RIGHT - add ARIA role, tabIndex, and labels
<div
  role="button"
  tabIndex={0}
  aria-label={item.name}
  onClick={handleClick}
  onKeyDown={handleKeyDown}
>
  {item.name}
</div>

// For lists with selection
<div
  role="listbox"
  aria-activedescendant={`item-${selectedId}`}
>
  {items.map(item => (
    <div
      id={`item-${item.id}`}
      role="option"
      aria-selected={item.id === selectedId}
    >
      {item.name}
    </div>
  ))}
</div>
```

**Warning signs:** Screen reader testing reveals missing announcements, keyboard navigation works but doesn't feel like native controls

**Sources:**
- [React Accessibility: Complete Guide for Developers](https://www.browserstack.com/guide/react-accessibility)
- [React Accessibility (A11y) Best Practices and Guidelines](https://rtcamp.com/handbook/react-best-practices/accessibility/)

### Pitfall 6: Preserving Inline onclick vs Converting to React Events

**What goes wrong:** Confusion about whether to preserve inline onclick strings (for postMessage calls) or convert to React onClick handlers

**Why it happens:** Existing HTML components have onclick="sendMessage(...)" strings that need special handling

**How to avoid:**
```typescript
// Current HTML generation pattern
onclick="sendMessage('exerciseDetail', { action: 'submit' })"

// WRONG - try to preserve as string in React
<button onclick="sendMessage(...)">Submit</button>  // Won't work in React

// RIGHT - convert to React onClick with callback prop
interface ButtonProps {
  onClick?: () => void;
}

// Component stays agnostic of postMessage
<Button onClick={handleSubmit} />

// Parent view wires to postMessage
const handleSubmit = () => {
  vscodeApi.postMessage({ type: 'exerciseDetail', action: 'submit' });
};
```

**Per user constraints:** Components stay agnostic of VS Code messaging. Calling views wire callbacks to postMessage. This keeps components reusable and testable.

**Warning signs:** onClick handlers don't fire, console errors about invalid event handlers

## Code Examples

Verified patterns from existing codebase and React best practices:

### Migrating Button Component

```typescript
// Source: iris-thaumantias/src/views/components/button/buttonComponent.ts (existing)
// Target: src/views/webview/react/components/Button/Button.tsx

import { CSSProperties } from 'react';
import styles from './Button.module.css';

export interface ButtonProps {
  label?: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'icon' | 'link' | 'ghost';
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  id?: string;
  fullWidth?: boolean;
  width?: string;
  height?: string;
  alignText?: 'left' | 'center' | 'right';
  dataAttributes?: Record<string, string>;
  type?: 'button' | 'submit' | 'reset';
  children?: React.ReactNode;
}

export function Button({
  label,
  icon,
  variant = 'primary',
  className = '',
  onClick,
  disabled = false,
  id,
  fullWidth = false,
  width,
  height,
  alignText,
  dataAttributes = {},
  type = 'button',
  children
}: ButtonProps) {
  const classes = [
    styles.btn,
    styles[`btn-${variant}`],
    fullWidth ? styles['btn-full-width'] : '',
    disabled ? styles['btn-disabled'] : '',
    (width || height) ? styles['btn-fixed-size'] : '',
    icon && (label || children) ? styles['btn-with-icon'] : '',
    alignText ? styles[`btn-align-${alignText}`] : '',
    className
  ].filter(Boolean).join(' ');

  const inlineStyles: CSSProperties = {};
  if (width) inlineStyles.width = width;
  if (height) inlineStyles.height = height;

  const dataProps = Object.entries(dataAttributes).reduce((acc, [key, value]) => {
    acc[`data-${key}`] = value;
    return acc;
  }, {} as Record<string, string>);

  // Icon-only button
  if (icon && !label && !children) {
    return (
      <button
        type={type}
        id={id}
        className={classes}
        onClick={onClick}
        disabled={disabled}
        style={inlineStyles}
        aria-label={id || 'button'}
        {...dataProps}
      >
        {icon}
      </button>
    );
  }

  // Button with icon and label/children
  if (icon && (label || children)) {
    return (
      <button
        type={type}
        id={id}
        className={classes}
        onClick={onClick}
        disabled={disabled}
        style={inlineStyles}
        {...dataProps}
      >
        <span className={styles['btn-icon']}>{icon}</span>
        <span className={styles['btn-label']}>{label || children}</span>
      </button>
    );
  }

  // Button with label/children only
  return (
    <button
      type={type}
      id={id}
      className={classes}
      onClick={onClick}
      disabled={disabled}
      style={inlineStyles}
      {...dataProps}
    >
      {label || children}
    </button>
  );
}

// Named exports for common variants
export const PrimaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="primary" {...props} />
);

export const SecondaryButton = (props: Omit<ButtonProps, 'variant'>) => (
  <Button variant="secondary" {...props} />
);
```

**Migration notes:**
1. Props interface closely matches existing ButtonOptions — minimal breaking changes
2. CSS classes map 1:1 from button.css to Button.module.css (rename file only)
3. Dynamic styles (width, height) use React inline styles via CSSProperties type
4. dataAttributes become spread props with data- prefix
5. children prop added for flexibility (can pass JSX instead of label string)
6. Named exports provide convenience methods matching existing static methods

### Migrating Container Component

```typescript
// Source: iris-thaumantias/src/views/components/container/containerComponent.ts (existing)
// Target: src/views/webview/react/components/Container/Container.tsx

import { CSSProperties } from 'react';
import styles from './Container.module.css';

type ContainerVariant = 'default' | 'muted' | 'highlight' | 'warning';
type ContainerPadding = 'default' | 'tight' | 'cozy' | 'spacious' | 'none';
type ContainerAccentPosition = 'left' | 'top' | 'none';

interface ContainerHeader {
  title?: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  actions?: React.ReactNode;
}

interface ContainerProps {
  children: React.ReactNode;
  id?: string;
  className?: string;
  variant?: ContainerVariant;
  padding?: ContainerPadding;
  accentPosition?: ContainerAccentPosition;
  accentColor?: string;
  outline?: string;
  header?: ContainerHeader;
  toolbar?: React.ReactNode;
  footer?: React.ReactNode;
  dataAttributes?: Record<string, string>;
}

export function Container({
  children,
  id,
  className = '',
  variant = 'default',
  padding = 'default',
  accentPosition = 'none',
  accentColor,
  outline,
  header,
  toolbar,
  footer,
  dataAttributes = {}
}: ContainerProps) {
  const classes = [
    styles['ui-container'],
    styles[`ui-container--${variant}`],
    padding !== 'default' ? styles[`ui-container--${padding}`] : '',
    accentPosition !== 'none' ? styles[`ui-container--accent-${accentPosition}`] : '',
    className
  ].filter(Boolean).join(' ');

  const inlineStyles: CSSProperties = {};
  if (accentColor) inlineStyles['--ui-container-accent-color' as any] = accentColor;
  if (outline) {
    inlineStyles.outline = outline;
    inlineStyles.outlineOffset = '2px';
  }

  const dataProps = Object.entries(dataAttributes).reduce((acc, [key, value]) => {
    acc[`data-${key}`] = value;
    return acc;
  }, {} as Record<string, string>);

  return (
    <div
      id={id}
      className={classes}
      style={inlineStyles}
      {...dataProps}
    >
      {header && (
        <div className={styles['ui-container__header']}>
          <div className={styles['ui-container__header-main']}>
            {header.icon && <span className={styles['ui-container__icon']}>{header.icon}</span>}
            <div className={styles['ui-container__title-wrap']}>
              {header.title && <p className={styles['ui-container__title']}>{header.title}</p>}
              {header.subtitle && <p className={styles['ui-container__subtitle']}>{header.subtitle}</p>}
            </div>
            {header.badge && <span className={styles['ui-container__badge']}>{header.badge}</span>}
          </div>
          {header.actions && <div className={styles['ui-container__actions']}>{header.actions}</div>}
        </div>
      )}
      {toolbar && <div className={styles['ui-container__toolbar']>{toolbar}</div>}
      <div className={styles['ui-container__body']}>{children}</div>
      {footer && <div className={styles['ui-container__footer']}>{footer}</div>}
    </div>
  );
}
```

**Migration notes:**
1. Removes collapsible state logic (can be added later if needed via useState)
2. Removes state block (empty/loading/error) — views handle this via children
3. Header becomes typed object prop instead of separate header generation method
4. CSS variable (--ui-container-accent-color) passed via inline style with type assertion
5. Maintains flat props interface per user constraints
6. toolbar, footer, header.actions use ReactNode for composition

**Sources:**
- Existing codebase patterns (listItemComponent.ts, containerComponent.ts, buttonComponent.ts)
- [Accessibility – React Aria](https://react-spectrum.adobe.com/react-aria/accessibility.html)

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| HTML string generation via static methods | React components with JSX | 2024-2026 (industry standard) | Better composition, type safety, DX |
| Inline onclick strings | React onClick callbacks | React 0.14+ (2015) | Enables component testing, removes eval-like patterns |
| Global CSS with manual prefixing | CSS Modules with auto-scoping | esbuild native support (2020+) | Prevents class name conflicts, better codesplitting |
| Styled Components / CSS-in-JS | CSS Modules + CSS variables | 2024-2026 (performance focus) | Lower bundle size, better caching, no runtime overhead |
| Template literals for class names | clsx or manual concatenation | 2020+ | Type-safe class names with CSS Modules |
| Uncontrolled forms with refs | Controlled forms with state | React best practice | Easier validation, coordination between fields |
| React.FC type | Function components without FC | TypeScript 5+ (2023+) | children not implicit, more explicit typing |

**Deprecated/outdated:**
- **ReactDOM.render()**: Deprecated in React 18, use createRoot (already done in Phase 1)
- **Class components for UI**: Function components + hooks are standard (exceptions: ErrorBoundary)
- **PropTypes**: TypeScript interfaces replace runtime prop validation
- **defaultProps**: Use default parameters in function signature (destructuring defaults)
- **componentWillMount, componentWillUpdate**: Removed in React 17, use useEffect/useLayoutEffect

**Sources:**
- [Building Reusable React Components in 2026](https://medium.com/@romko.kozak/building-reusable-react-components-in-2026-a461d30f8ce4)
- React 18 Migration Guide (createRoot)

## Open Questions

1. **TypeScript definitions for CSS Modules**
   - What we know: esbuild native local-css loader handles .module.css, but no auto-generated .d.ts files
   - What's unclear: Whether to add typed-css-modules plugin or declare module '*.module.css' globally
   - Recommendation: Start with global declaration in src/types.d.ts, add typed-css-modules in Phase 3+ if type safety becomes pain point
   ```typescript
   // src/types.d.ts
   declare module '*.module.css' {
     const classes: { [key: string]: string };
     export default classes;
   }
   ```

2. **React.memo for list items**
   - What we know: Large lists (20+ courses, exercises) currently render via HTML strings, no re-render cost
   - What's unclear: Whether React re-renders will cause noticeable performance regression
   - Recommendation: Start without React.memo, add selectively in Phase 3 during view migration if profiling shows issues. Likely candidates: CourseListItem, ExerciseListItem with many props

3. **Shared exercise component folder naming**
   - What we know: ExerciseDetail and ExamExerciseDetail share ~70% of code per requirements
   - What's unclear: Exact shared components (ParticipationActions, SubmissionStatus, BuildProgress, etc.)
   - Recommendation: Create components/exercise/ folder, move shared components there during Phase 5 (exercise views migration) when duplication becomes visible

4. **Icon component approach**
   - What we know: Existing code has inline SVG strings in icon definitions
   - What's unclear: Whether to keep as strings and pass as ReactNode, or create icon components
   - Recommendation: Keep as inline SVG strings, pass as ReactNode props to IconButton. Create icon utility if needed:
   ```typescript
   // utils/icons.tsx
   export const CloseIcon = () => <svg>...</svg>;
   // Usage: <IconButton icon={<CloseIcon />} />
   ```

## Sources

### Primary (HIGH confidence)

- **Existing codebase analysis** - iris-thaumantias/src/views/components/ (23 component files examined)
- **Phase 1 implementation** - esbuild.js, package.json, tsconfig.json (React 18.3.1, automatic JSX, confirmed setup)
- **User constraints** - .planning/phases/02-shared-component-library/02-CONTEXT.md (locked decisions from /gsd:discuss-phase)
- **esbuild documentation** - CSS Modules native support via local-css loader (verified in v0.27.2)

### Secondary (MEDIUM confidence)

- [How to write type-safe CSS Modules](https://blog.logrocket.com/write-type-safe-css-modules/)
- [React & CSS in 2026: Best Styling Approaches Compared](https://medium.com/@imranmsa93/react-css-in-2026-best-styling-approaches-compared-d5e99a771753)
- [Complete Guide to Setting Up React with TypeScript and esbuild (2026)](https://medium.com/@robinviktorsson/complete-guide-to-setting-up-react-with-typescript-and-esbuild-2025-88767a3a5593)
- [Mastering React's Children Props: A Reusable Components](https://mernstackdev.com/mastering-reacts-children-props/)
- [React children composition patterns with TypeScript](https://medium.com/@martin_hotell/react-children-composition-patterns-with-typescript-56dfc8923c64)
- [React Accessibility: Complete Guide for Developers](https://www.browserstack.com/guide/react-accessibility)
- [Accessibility – React Aria](https://react-spectrum.adobe.com/react-aria/accessibility.html)
- [Controlled vs Uncontrolled Components in React](https://certificates.dev/blog/controlled-vs-uncontrolled-components-in-react)
- [React: Controlled vs Uncontrolled Components](https://pieces.app/blog/controlled-vs-uncontrolled-components-in-react)
- [How to Fix "Controlled vs Uncontrolled" Input Warnings](https://oneuptime.com/blog/post/2026-01-24-fix-controlled-uncontrolled-input-warnings/view)

### Tertiary (LOW confidence)

- [Converting static HTML/CSS site to React App](https://dev.to/menard_codes/converting-static-html-css-site-to-react-app-263e) - General migration guide, not VS Code specific
- [Strategy and Tips for Migrating to React](https://brainhub.eu/library/migrating-to-react) - High-level strategy, lacks technical specifics
- [Use CSS Modules instead of inlining styles in React](https://swarup-karavadi.medium.com/use-css-modules-instead-of-inlining-styles-in-react-fea247b97431) - Performance claims need verification in specific context

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - React 18.3.1 and esbuild 0.27.2 already configured in Phase 1, CSS Modules native support verified in esbuild docs
- Architecture: HIGH - User constraints provide locked decisions, existing codebase patterns are clear (23 components analyzed)
- Pitfalls: MEDIUM - Based on web search + existing code patterns, but some edge cases may surface during implementation

**Research date:** 2026-02-23
**Valid until:** 2026-03-25 (30 days - stable domain, React 18 mature, esbuild API stable)
