export type ContainerVariant = 'default' | 'muted' | 'highlight' | 'warning';
export type ContainerPadding = 'default' | 'tight' | 'cozy' | 'spacious' | 'none';
export type ContainerAccentPosition = 'left' | 'top' | 'none';
export type ContainerStateType = 'empty' | 'info' | 'warning' | 'error' | 'loading';
export type ContainerTextAlign = 'left' | 'center' | 'right';
export type ContainerVerticalAlign = 'top' | 'center' | 'bottom';
export type ContainerFontSize = 'small' | 'default' | 'large' | 'xlarge';

export interface ContainerState {
  type: ContainerStateType;
  message: string;
  hint?: string;
}

export interface ContainerHeaderOptions {
  /** Main heading */
  title?: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Optional icon HTML placed before the title */
  icon?: string;
  /** Lightweight badge text (for counts or status) */
  badge?: string;
  /** Custom actions HTML aligned to the right (dropdowns, links, buttons) */
  actionsHtml?: string;
  /** Whether the container can collapse */
  collapsible?: boolean;
  /** Initial collapse state */
  collapsed?: boolean;
  /** Optional ID for the collapsible content (falls back to container ID) */
  collapseId?: string;
  /** Accessible label for the collapse toggle */
  ariaToggleLabel?: string;
  /** Show a divider line below the header */
  divider?: boolean;
  /** Text alignment for the header */
  textAlign?: ContainerTextAlign;
  /** Font size for the title */
  titleSize?: ContainerFontSize;
  /** Font size for the subtitle */
  subtitleSize?: ContainerFontSize;
}

export interface ContainerOptions {
  id?: string;
  className?: string;
  variant?: ContainerVariant;
  padding?: ContainerPadding;
  accentPosition?: ContainerAccentPosition;
  accentColor?: string;
  outline?: string;
  listMode?: boolean;
  /** Provide HTML for toolbar/filters placed above body content */
  toolbarHtml?: string;
  /** Main body HTML content */
  bodyHtml?: string;
  /** Custom body wrapper class */
  bodyClassName?: string;
  /** Footer HTML (secondary actions/hints) */
  footerHtml?: string;
  /** Custom footer wrapper class */
  footerClassName?: string;
  /** State block to show instead of the body */
  state?: ContainerState;
  /** Additional data attributes */
  dataAttributes?: Record<string, string>;
  /** Header configuration */
  header?: ContainerHeaderOptions;
  /** Text alignment for body content */
  textAlign?: ContainerTextAlign;
  /** Vertical alignment for body content (requires explicit height) */
  verticalAlign?: ContainerVerticalAlign;
  /** Font size for body content */
  bodyFontSize?: ContainerFontSize;
}

/**
 * A reusable container/card shell that standardizes padding, headers,
 * collapse behavior, accent stripes, and empty/loading states across views.
 *
 * Suggested mappings:
 * - Dashboard recent courses + controls -> header title + actionsHtml + listMode.
 * - Exam card + active outline -> highlight variant, outline, accent left.
 * - Course detail sections (collapsible) -> collapsible header with badge for counts.
 * - Exercise detail blocks (actions + description) -> toolbar + body + footer.
 */
export class ContainerComponent {
  public static generate(options: ContainerOptions): string {
    const {
      id,
      className = '',
      variant = 'default',
      padding = 'default',
      accentPosition = 'none',
      accentColor,
      outline,
      listMode = false,
      toolbarHtml = '',
      bodyHtml = '',
      bodyClassName = '',
      footerHtml = '',
      footerClassName = '',
      state,
      dataAttributes = {},
      header,
      textAlign,
      verticalAlign,
      bodyFontSize
    } = options;

    const containerId = id || `ui-container-${Math.random().toString(36).slice(2, 8)}`;
    const isCollapsible = Boolean(header?.collapsible);
    const isCollapsed = isCollapsible ? Boolean(header?.collapsed) : false;
    const collapseId = header?.collapseId || `${containerId}-content`;

    const classes = [
      'ui-container',
      `ui-container--${variant}`,
      padding === 'tight' ? 'ui-container--tight' : '',
      padding === 'cozy' ? 'ui-container--cozy' : '',
      padding === 'spacious' ? 'ui-container--spacious' : '',
      padding === 'none' ? 'ui-container--no-padding' : '',
      accentPosition === 'left' ? 'ui-container--accent-left' : '',
      accentPosition === 'top' ? 'ui-container--accent-top' : '',
      listMode ? 'ui-container--list' : '',
      isCollapsed ? 'is-collapsed' : '',
      textAlign ? `ui-container--text-${textAlign}` : '',
      verticalAlign ? `ui-container--valign-${verticalAlign}` : '',
      bodyFontSize && bodyFontSize !== 'default' ? `ui-container--body-font-${bodyFontSize}` : '',
      className
    ]
      .filter(Boolean)
      .join(' ');

    const stylePieces: string[] = [];
    if (accentColor) {
      stylePieces.push(`--ui-container-accent-color: ${this._escapeAttr(accentColor)}`);
    }
    if (outline) {
      stylePieces.push(`outline: ${this._escapeAttr(outline)}`);
      stylePieces.push('outline-offset: 2px');
    }
    const styleAttr = stylePieces.length ? ` style="${stylePieces.join('; ')}"` : '';

    const dataAttrs = Object.entries(dataAttributes)
      .map(([key, value]) => ` data-${this._escapeAttr(key)}="${this._escapeAttr(value)}"`)
      .join('');

    const headerHtml = header ? this._buildHeader(header, containerId, collapseId, isCollapsed) : '';
    const bodyClasses = ['ui-container__body', bodyClassName].filter(Boolean).join(' ');
    const footerClasses = ['ui-container__footer', footerClassName].filter(Boolean).join(' ');
    const toolbarSection = toolbarHtml
      ? `<div class="ui-container__toolbar">${toolbarHtml}</div>`
      : '';
    const bodySection = state
      ? this._buildState(state)
      : `<div class="${bodyClasses}">${bodyHtml}</div>`;
    const footerSection = footerHtml
      ? `<div class="${footerClasses}">${footerHtml}</div>`
      : '';
    const contentSection = `
      <div class="ui-container__content" id="${this._escapeAttr(collapseId)}" aria-hidden="${isCollapsed}">
        ${toolbarSection}
        ${bodySection}
        ${footerSection}
      </div>
    `;

    return `
      <div
        class="${classes}"
        id="${this._escapeAttr(containerId)}"
        ${dataAttrs}
        ${isCollapsible ? 'data-container-collapsible="true"' : ''}
        ${styleAttr}
      >
        ${headerHtml}
        ${contentSection}
      </div>
    `;
  }

  public static generateScript(): string {
    return `
      (function initContainerComponent() {
        document.addEventListener('click', function(event) {
          const targetElement = event.target instanceof Element ? event.target : null;
          const toggle = targetElement ? targetElement.closest('[data-container-toggle]') : null;
          if (!toggle) {
            return;
          }

          const targetId = toggle.getAttribute('data-container-toggle');
          const container = targetId ? document.getElementById(targetId) : null;
          if (!container) {
            return;
          }

          const collapsed = container.classList.toggle('is-collapsed');
          const contentId = toggle.getAttribute('aria-controls');
          const content = contentId ? document.getElementById(contentId) : container.querySelector('.ui-container__content');

          if (content) {
            content.setAttribute('aria-hidden', collapsed ? 'true' : 'false');
          }

          toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        });
      })();
    `;
  }

  private static _buildHeader(
    header: ContainerHeaderOptions,
    containerId: string,
    collapseId: string,
    isCollapsed: boolean
  ): string {
    const {
      title,
      subtitle,
      icon,
      badge,
      actionsHtml,
      collapsible,
      ariaToggleLabel,
      divider,
      textAlign,
      titleSize,
      subtitleSize
    } = header;

    const titleSizeClass = titleSize && titleSize !== 'default' ? ` ui-container__title--${titleSize}` : '';
    const subtitleSizeClass = subtitleSize && subtitleSize !== 'default' ? ` ui-container__subtitle--${subtitleSize}` : '';
    const titleHtml = title
      ? `<p class="ui-container__title${titleSizeClass}">${this._escapeHtml(title)}</p>`
      : '';
    const subtitleHtml = subtitle
      ? `<p class="ui-container__subtitle${subtitleSizeClass}">${this._escapeHtml(subtitle)}</p>`
      : '';
    const badgeHtml = badge ? `<span class="ui-container__badge">${this._escapeHtml(badge)}</span>` : '';
    const iconHtml = icon ? `<span class="ui-container__icon">${icon}</span>` : '';

    const toggleHtml = collapsible
      ? `
        <button
          class="ui-container__toggle"
          type="button"
          aria-expanded="${isCollapsed ? 'false' : 'true'}"
          aria-controls="${this._escapeAttr(collapseId)}"
          aria-label="${this._escapeAttr(ariaToggleLabel || 'Toggle section')}"
          data-container-toggle="${this._escapeAttr(containerId)}"
        >
          <span class="ui-container__chevron" aria-hidden="true"></span>
        </button>
      `
      : '';

    const actions = actionsHtml
      ? `<div class="ui-container__actions">${actionsHtml}</div>`
      : toggleHtml;

    const headerMain = `
      <div class="ui-container__header-main">
        ${iconHtml}
        <div class="ui-container__title-wrap">
          ${titleHtml}
          ${subtitleHtml}
        </div>
        ${badgeHtml}
      </div>
    `;

    const dividerHtml = divider ? '<div class="ui-container__divider"></div>' : '';
    const headerAlignClass = textAlign ? ` ui-container__header--${textAlign}` : '';

    return `
      <div class="ui-container__header${headerAlignClass}">
        ${headerMain}
        ${actions}
      </div>
      ${dividerHtml}
    `;
  }

  private static _buildState(state: ContainerState): string {
    const title = this._escapeHtml(state.message);
    const hint = state.hint ? `<p class="ui-container__state-hint">${this._escapeHtml(state.hint)}</p>` : '';
    const type = state.type === 'empty' ? 'info' : state.type;

    return `
      <div class="ui-container__state" data-type="${this._escapeAttr(type)}">
        <p class="ui-container__state-title">${title}</p>
        ${hint}
      </div>
    `;
  }

  private static _escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private static _escapeAttr(str: string): string {
    return this._escapeHtml(str);
  }
}
