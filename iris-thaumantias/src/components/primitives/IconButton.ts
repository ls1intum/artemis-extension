import { Button, ButtonProps } from './Button';
import { mergeClassNames } from '../utils/markup';

export interface IconButtonProps extends Omit<ButtonProps, 'label' | 'leadingIcon' | 'trailingIcon' | 'variant'> {
    icon: string;
    label?: string;
    variant?: ButtonProps['variant'];
}

export function IconButton(props: IconButtonProps): string {
    const { icon, label = '', className, variant = 'ghost', ...rest } = props;

    return Button({
        ...rest,
        label,
        variant,
        leadingIcon: icon,
        className: mergeClassNames('iris-icon-button', className),
    });
}
