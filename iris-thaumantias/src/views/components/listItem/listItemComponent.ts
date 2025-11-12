export interface ListItemConfig {
  /** Unique identifier for the item */
  id?: string;
  /** CSS class names to add to the list item */
  className?: string;
  /** Whether the item is clickable/interactive */
  clickable?: boolean;
  /** Command to execute when clicked (if clickable) */
  command?: string;
  /** Whether to show a hover effect */
  hover?: boolean;
  /** Whether the item is selected/active */
  selected?: boolean;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Additional data attributes */
  dataAttributes?: Record<string, string>;
}

/**
 * A reusable list item component that provides consistent styling
 * for list items across different views (courses, exercises, etc.).
 * 
 * The component handles the container/card styling while allowing
 * custom content to be rendered inside.
 */
export class ListItemComponent {
  /**
   * Generate the HTML for a list item container
   * @param config Configuration for the list item
   * @param content The inner HTML content to render inside the list item
   * @returns HTML string for the list item
   */
  static generate(config: ListItemConfig, content: string): string {
    const {
      id,
      className = '',
      clickable = false,
      command,
      hover = true,
      selected = false,
      disabled = false,
      dataAttributes = {}
    } = config;

    // Build class names
    const classes = [
      'list-item',
      className,
      clickable ? 'list-item--clickable' : '',
      hover ? 'list-item--hover' : '',
      selected ? 'list-item--selected' : '',
      disabled ? 'list-item--disabled' : ''
    ].filter(Boolean).join(' ');

    // Build data attributes
    const dataAttrs = Object.entries(dataAttributes)
      .map(([key, value]) => `data-${key}="${this._escapeHtml(value)}"`)
      .join(' ');

    // Build id attribute
    const idAttr = id ? `id="${this._escapeHtml(id)}"` : '';

    // Build onclick handler
    const onclickAttr = clickable && command ? `onclick="${this._escapeHtml(command)}"` : '';

    // Build role and tabindex for accessibility
    const roleAttr = clickable ? 'role="button"' : '';
    const tabindexAttr = clickable && !disabled ? 'tabindex="0"' : '';

    return `
      <div 
        class="${classes}" 
        ${idAttr}
        ${onclickAttr}
        ${roleAttr}
        ${tabindexAttr}
        ${dataAttrs}
      >
        ${content}
      </div>
    `;
  }

  /**
   * Escape HTML to prevent XSS
   */
  private static _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generate the CSS styles for list items
   * This should be included in the view's CSS
   */
  static generateStyles(): string {
    return `
      .list-item {
        background: var(--theme-card-background);
        border: 1px solid var(--theme-border);
        border-radius: var(--theme-container-radius);
        padding: var(--theme-container-padding);
        margin-bottom: var(--theme-element-spacing);
        transition: var(--theme-transition);
        position: relative;
      }

      .list-item--hover:hover {
        border-color: var(--theme-primary-color);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .list-item--clickable {
        cursor: pointer;
      }

      .list-item--clickable:active {
        transform: translateY(1px);
      }

      .list-item--selected {
        border-color: var(--theme-primary-color);
        background: var(--theme-primary-background);
      }

      .list-item--disabled {
        opacity: 0.6;
        cursor: not-allowed;
        pointer-events: none;
      }

      /* Keyboard focus */
      .list-item--clickable:focus {
        outline: 2px solid var(--theme-primary-color);
        outline-offset: 2px;
      }

      .list-item--clickable:focus:not(:focus-visible) {
        outline: none;
      }

      /* Remove bottom margin from last item */
      .list-item:last-child {
        margin-bottom: 0;
      }
    `;
  }

  /**
   * Generate keyboard navigation script for list items
   * This enables arrow key navigation and Enter/Space activation
   */
  static generateScript(): string {
    return `
      // Enable keyboard navigation for list items
      (function initListItemKeyboardNav() {
        document.addEventListener('keydown', function(event) {
          const target = event.target;
          
          // Only handle list items
          if (!target.classList.contains('list-item--clickable')) {
            return;
          }

          // Enter or Space to activate
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            target.click();
          }

          // Arrow key navigation
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            
            const items = Array.from(document.querySelectorAll('.list-item--clickable:not(.list-item--disabled)'));
            const currentIndex = items.indexOf(target);
            
            if (currentIndex === -1) return;
            
            let nextIndex;
            if (event.key === 'ArrowDown') {
              nextIndex = currentIndex + 1;
              if (nextIndex >= items.length) nextIndex = 0;
            } else {
              nextIndex = currentIndex - 1;
              if (nextIndex < 0) nextIndex = items.length - 1;
            }
            
            items[nextIndex].focus();
          }
        });
      })();
    `;
  }
}
