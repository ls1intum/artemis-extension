import { IconDefinitions } from '../../../utils/iconDefinitions';
import { CloseButton } from '../button/iconButtons/closeButton';
import { ListItemComponent } from '../listItem/listItemComponent';

export interface HelpPopupOptions {
    /** Additional CSS classes */
    className?: string;
}

/**
 * HelpPopup component for the Iris Chat view.
 * Displays a modal explaining how to use different chat contexts (exercises vs courses).
 */
export class HelpPopupComponent {
    /**
     * Generates the HTML for the help popup overlay and content.
     * @param options - Optional configuration options
     * @returns HTML string for the help popup
     */
    public static generate(options: HelpPopupOptions = {}): string {
        const { className = '' } = options;
        
        const exerciseIcon = IconDefinitions.getIcon('exercise');
        const courseIcon = IconDefinitions.getIcon('course');

        const exerciseSectionContent = `
            <div class="help-section-header">
                <span class="help-icon">${exerciseIcon}</span>
                <h3>Exercises</h3>
            </div>
            <div class="help-section-content">
                <p><strong>Best for:</strong> Hands-on programming work, debugging, and implementation hints.</p>
                <p><strong>Use when you want to:</strong></p>
                <ul>
                    <li>Understand or refine your solution approach</li>
                    <li>Debug code or clarify error messages</li>
                    <li>Get targeted hints about the next step</li>
                </ul>
            </div>
        `;

        const courseSectionContent = `
            <div class="help-section-header">
                <span class="help-icon">${courseIcon}</span>
                <h3>Courses</h3>
            </div>
            <div class="help-section-content">
                <p><strong>Best for:</strong> Conceptual understanding, broader course context, or lecture materials.</p>
                <p><strong>Use when you want to:</strong></p>
                <ul>
                    <li>Clarify theoretical concepts</li>
                    <li>Understand how exercises fit into the course</li>
                    <li>Plan your learning path across topics</li>
                </ul>
            </div>
        `;

        return `
            <div class="help-overlay${className ? ` ${className}` : ''}" id="helpOverlay" onclick="closeHelpPopup()"></div>
            <div class="help-popup${className ? ` ${className}` : ''}" id="helpPopup">
                <div class="help-popup-header">
                    <h2 class="help-popup-title">Chat Context Guide</h2>
                    ${CloseButton.generate({
                        command: 'closeHelpPopup()',
                        title: 'Close Help',
                        className: 'close-help-btn'
                    })}
                </div>
                <div class="help-popup-content">
                    <p class="help-intro">
                        Choose the right chat context to get the most relevant help from Iris. Each context is designed for specific types of questions and learning scenarios.
                    </p>
                    <div class="help-sections">
                        ${ListItemComponent.generate({ className: 'help-section', hover: false }, exerciseSectionContent)}
                        ${ListItemComponent.generate({ className: 'help-section', hover: false }, courseSectionContent)}
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Generates the JavaScript functions needed for help popup interaction.
     * @returns JavaScript code string for popup open/close functions
     */
    public static getScript(): string {
        return `
            window.openHelpPopup = function() {
                document.getElementById('helpOverlay').classList.add('open');
                document.getElementById('helpPopup').classList.add('open');
                closeSideMenu();
            };

            window.closeHelpPopup = function() {
                document.getElementById('helpOverlay').classList.remove('open');
                document.getElementById('helpPopup').classList.remove('open');
            };
        `;
    }
}
