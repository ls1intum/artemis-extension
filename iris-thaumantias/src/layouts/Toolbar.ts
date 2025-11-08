export interface ToolbarProps {
    id?: string;
    title?: string;
    subtitle?: string;
    leading?: string;
    actions?: string;
    className?: string;
    titleClassName?: string;
    subtitleClassName?: string;
}

export const Toolbar = ({
    id,
    title,
    subtitle,
    leading,
    actions,
    className,
    titleClassName,
    subtitleClassName,
}: ToolbarProps): string => {
    const classes = ['iris-toolbar'];
    if (className) {
        classes.push(className);
    }

    const idAttr = id ? ` id="${id}"` : '';
    const titleMarkup = title
        ? `<div class="iris-toolbar__titles">` +
          `<span class="iris-toolbar__title${titleClassName ? ` ${titleClassName}` : ''}">${title}</span>` +
          (subtitle
              ? `<span class="iris-toolbar__subtitle${subtitleClassName ? ` ${subtitleClassName}` : ''}">${subtitle}</span>`
              : '') +
          `</div>`
        : '';

    const leadingMarkup = leading ? `<div class="iris-toolbar__leading">${leading}</div>` : '';
    const actionsMarkup = actions ? `<div class="iris-toolbar__actions">${actions}</div>` : '';

    return `<header class="${classes.join(' ')}"${idAttr}>${leadingMarkup}${titleMarkup}${actionsMarkup}</header>`;
};
