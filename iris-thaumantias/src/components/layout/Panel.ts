import { AttributeValue, buildAttributes, mergeClassNames } from '../utils/markup';

export interface PanelProps {
    id?: string;
    title?: string;
    headerActions?: string;
    children: string;
    className?: string;
    attributes?: Record<string, AttributeValue | AttributeValue[]>;
}

export function Panel(props: PanelProps): string {
    const { id, title, headerActions, children, className, attributes = {} } = props;
    const classes = mergeClassNames('iris-panel', className);

    const attributeMap: Record<string, AttributeValue | AttributeValue[]> = {
        id,
        class: classes,
        ...attributes,
    };

    const headerMarkup = title
        ? `<div class="iris-panel__header"><h2 class="iris-panel__title">${title}</h2>${headerActions ? `<div class="iris-panel__actions">${headerActions}</div>` : ''}</div>`
        : '';

    return `<section ${buildAttributes(attributeMap)}>${headerMarkup}<div class="iris-panel__content">${children}</div></section>`;
}
