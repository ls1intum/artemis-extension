import { Button, ButtonProps } from './Button';

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'label' | 'iconPosition'> {
    label?: string;
}

export const IconButton = ({
    icon,
    label,
    ariaLabel,
    className,
    size = 'sm',
    variant = 'ghost',
    ...rest
}: IconButtonProps): string => {
    const mergedClassName = ['iris-icon-button', className].filter(Boolean).join(' ') || undefined;
    const resolvedAria = ariaLabel ?? label ?? undefined;
    return Button({
        ...rest,
        icon,
        ariaLabel: resolvedAria,
        label,
        variant,
        size,
        className: mergedClassName,
    });
};
