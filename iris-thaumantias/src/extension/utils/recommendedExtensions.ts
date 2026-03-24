export interface RecommendedExtension {
    id: string;
    name: string;
    publisher: string;
    description: string;
    reason: string;
    optional?: boolean;
    version?: string;
    isInstalled?: boolean;
}

export interface RecommendedExtensionCategory {
    id: string;
    name: string;
    description: string;
    extensions: RecommendedExtension[];
}

const RECOMMENDED_EXTENSION_CATEGORIES: RecommendedExtensionCategory[] = [
    {
        id: 'java',
        name: 'Java Development',
        description: 'Core tooling that supports Java-based Artemis programming exercises.',
        extensions: [
            {
                id: 'vscjava.vscode-java-pack',
                name: 'Extension Pack for Java',
                publisher: 'Microsoft',
                description: 'Bundles language support, debugger, project manager, test runner, and Maven tooling for Java.',
                reason: 'Baseline toolkit for Java programming exercises in Artemis.',
            },
            {
                id: 'vscjava.vscode-gradle',
                name: 'Gradle for Java',
                publisher: 'Microsoft',
                description: 'Adds Gradle Tasks explorer, build integration, and dependency insights.',
                reason: 'Required to work with the Gradle build scripts used in many Artemis templates.',
            },
            {
                id: 'k--kato.intellij-idea-keybindings',
                name: 'IntelliJ IDEA Keybindings',
                publisher: 'Kei Kato',
                description: 'Replicates IntelliJ IDEA shortcuts inside VS Code.',
                reason: 'Helpful if you are accustomed to IntelliJ shortcuts from Artemis courses.',
            },
            {
                id: 'maptz.regionfolder',
                name: '#region folding for VS Code',
                publisher: 'Maptz',
                description: 'Enables custom folding regions using #region and #endregion comments in any language.',
                reason: 'Optional: helps organize and collapse code sections for better readability.',
                optional: true,
            },
        ],
    },
];

export function getRecommendedExtensionsByCategory(): RecommendedExtensionCategory[] {
    return RECOMMENDED_EXTENSION_CATEGORIES.map(category => ({
        ...category,
        extensions: category.extensions.map(extension => ({ ...extension })),
    }));
}
