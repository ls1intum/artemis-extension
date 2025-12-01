import { IconDefinitions } from '../../../utils/iconDefinitions';
import { CloseButton } from '../button/iconButtons/closeButton';
import { ListItemComponent } from '../listItem/listItemComponent';

export interface SideMenuSection {
    /** Section title */
    title: string;
    /** Menu items in this section */
    items?: SideMenuItem[];
    /** Custom HTML content (for non-item sections like "About") */
    customHtml?: string;
}

export interface SideMenuItem {
    /** Icon name from IconDefinitions */
    icon: string;
    /** Menu item title */
    title: string;
    /** Menu item description */
    description: string;
    /** Command to execute on click */
    command: string;
}

export interface SideMenuOptions {
    /** Menu title */
    title?: string;
    /** Menu sections */
    sections: SideMenuSection[];
    /** Additional CSS classes */
    className?: string;
}

/**
 * SideMenu component for slide-out menu panels.
 * Used in Iris Chat for accessing menu options, help, and diagnostics.
 */
export class SideMenuComponent {
    /**
     * Generates the HTML for the side menu overlay and panel.
     * @param options - Configuration options for the menu
     * @returns HTML string for the side menu
     */
    public static generate(options: SideMenuOptions): string {
        const { title = 'Menu', sections, className = '' } = options;

        const sectionsHtml = sections
            .map(section => this.generateSection(section))
            .join('');

        return `
            <div class="menu-overlay${className ? ` ${className}` : ''}" id="menuOverlay" onclick="closeSideMenu()"></div>
            <div class="side-menu${className ? ` ${className}` : ''}" id="sideMenu">
                <div class="side-menu-header">
                    <h3 class="side-menu-title">${title}</h3>
                    ${CloseButton.generate({
                        command: 'closeSideMenu()',
                        title: 'Close Menu',
                        className: 'close-menu-btn'
                    })}
                </div>
                <div class="side-menu-content">
                    ${sectionsHtml}
                </div>
            </div>
        `;
    }

    /**
     * Generates HTML for a single menu section.
     */
    private static generateSection(section: SideMenuSection): string {
        let contentHtml = '';

        if (section.customHtml) {
            contentHtml = section.customHtml;
        } else if (section.items && section.items.length > 0) {
            contentHtml = section.items
                .map(item => this.generateMenuItem(item))
                .join('');
        }

        return `
            <div class="menu-section">
                <h4 class="menu-section-title">${section.title}</h4>
                ${contentHtml}
            </div>
        `;
    }

    /**
     * Generates HTML for a single menu item.
     */
    private static generateMenuItem(item: SideMenuItem): string {
        const icon = IconDefinitions.getIcon(item.icon);

        return ListItemComponent.generate(
            {
                className: 'menu-item',
                clickable: true,
                command: item.command
            },
            `${icon}
            <div class="menu-item-content">
                <div class="menu-item-title">${item.title}</div>
                <div class="menu-item-description">${item.description}</div>
            </div>`
        );
    }

    /**
     * Generates the JavaScript functions needed for side menu interaction.
     * @returns JavaScript code string for menu toggle/close functions
     */
    public static getScript(): string {
        return `
            window.toggleSideMenu = function() {
                const sideMenu = document.getElementById('sideMenu');
                const menuOverlay = document.getElementById('menuOverlay');
                const burger = document.getElementById('burgerMenuBtn');
                const isOpen = sideMenu.classList.contains('open');

                if (isOpen) {
                    sideMenu.classList.remove('open');
                    menuOverlay.classList.remove('open');
                    burger?.classList.remove('icon-btn-burger-menu-open');
                } else {
                    sideMenu.classList.add('open');
                    menuOverlay.classList.add('open');
                    burger?.classList.add('icon-btn-burger-menu-open');
                }
            };

            window.closeSideMenu = function() {
                document.getElementById('sideMenu').classList.remove('open');
                document.getElementById('menuOverlay').classList.remove('open');
                document.getElementById('burgerMenuBtn')?.classList.remove('icon-btn-burger-menu-open');
            };
        `;
    }
}
