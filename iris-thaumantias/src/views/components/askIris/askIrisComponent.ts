import { ButtonComponent } from '../button/buttonComponent';
import { ContainerComponent } from '../container/containerComponent';

export interface AskIrisOptions {
    /** Optional element ID for the container */
    id?: string;
    /** Additional custom classes */
    className?: string;
    /** Heading text */
    title?: string;
    /** Supporting description */
    description?: string;
    /** Button label */
    buttonLabel?: string;
    /** Button element ID (used by callers to bind events) */
    buttonId?: string;
    /** Inline command for the button (most callers attach listeners instead) */
    buttonCommand?: string;
    /** Whether the button should stretch to the available width */
    buttonFullWidth?: boolean;
}

/**
 * Shared "Ask Iris" call-to-action card.
 * Renders a compact container with a title, description, and a primary button.
 */
export class AskIrisComponent {
    public static generate(options: AskIrisOptions = {}): string {
        const {
            id = 'ask-iris-card',
            className = '',
            title = 'Ask Iris',
            description = 'Open the Iris chat to discuss or get guidance.',
            buttonLabel = 'Ask Iris',
            buttonId,
            buttonCommand = '',
            buttonFullWidth = false
        } = options;

        const classes = ['ask-iris-card', className].filter(Boolean).join(' ');

        return ContainerComponent.generate({
            id,
            className: classes,
            header: {
                title,
                subtitle: description,
                actionsHtml: ButtonComponent.generate({
                    label: buttonLabel,
                    variant: 'primary',
                    id: buttonId,
                    command: buttonCommand,
                    fullWidth: buttonFullWidth
                })
            },
            bodyHtml: ''
        });
    }
}
