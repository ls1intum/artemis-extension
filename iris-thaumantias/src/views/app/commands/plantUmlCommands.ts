import * as vscode from 'vscode';
import { processPlantUml } from '../../../utils';
import type { CommandContext, CommandMap } from './types';

export class PlantUmlCommandModule {
    constructor(private readonly context: CommandContext) {}

    public getHandlers(): CommandMap {
        return {
            renderPlantUml: this.handleRenderPlantUml,
            renderPlantUmlInline: this.handleRenderPlantUmlInline,
            openPlantUmlInNewTab: this.handleOpenPlantUmlInNewTab,
        };
    }

    private handleRenderPlantUml = async (message: any): Promise<void> => {
        const plantUmlDiagrams: string[] = message.plantUmlDiagrams;
        const exerciseTitle: string | undefined = message.exerciseTitle;

        if (!plantUmlDiagrams || plantUmlDiagrams.length === 0) {
            vscode.window.showWarningMessage('No PlantUML diagrams found to render.');
            return;
        }

        try {
            console.log('🎨 Rendering PlantUML diagrams from exercise:', exerciseTitle);
            console.log('📊 PlantUML content:', plantUmlDiagrams);

            const combinedPlantUml = plantUmlDiagrams.join('\n\n');

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Rendering ${plantUmlDiagrams.length} PlantUML diagram${plantUmlDiagrams.length > 1 ? 's' : ''}...`,
                cancellable: false
            }, async () => {
                await vscode.commands.executeCommand('artemis.renderPlantUmlFromWebview', combinedPlantUml, exerciseTitle);
            });
        } catch (error) {
            console.error('Render PlantUML error:', error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to render PlantUML: ${errorMsg}`);
        }
    };

    private handleRenderPlantUmlInline = async (message: any): Promise<void> => {
        const plantUml: string = message.plantUml;
        const index: number = message.index;

        if (!plantUml) {
            this.context.sendMessage({
                command: 'plantUmlError',
                index: index,
                error: 'No PlantUML content provided'
            });
            return;
        }

        try {
            console.log(`🎨 Rendering inline PlantUML diagram ${index + 1}`);

            const processedPlantUml = processPlantUml(plantUml);
            const isDarkTheme = vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark;
            const svg = await this.context.artemisApi.renderPlantUmlToSvg(processedPlantUml, isDarkTheme);

            this.context.sendMessage({
                command: 'plantUmlRendered',
                index: index,
                svg: svg
            });

            console.log(`✅ Inline PlantUML diagram ${index + 1} rendered successfully`);
        } catch (error) {
            console.error(`Render inline PlantUML error for diagram ${index + 1}:`, error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            this.context.sendMessage({
                command: 'plantUmlError',
                index: index,
                error: errorMsg
            });
        }
    };

    private handleOpenPlantUmlInNewTab = async (message: any): Promise<void> => {
        const plantUml: string = message.plantUml;
        const index: number = message.index;

        if (!plantUml) {
            vscode.window.showWarningMessage('No PlantUML content to open.');
            return;
        }

        try {
            console.log(`🎨 Opening PlantUML diagram ${index + 1} in new tab`);

            const processedPlantUml = processPlantUml(plantUml);
            await vscode.commands.executeCommand('artemis.renderPlantUmlFromWebview', processedPlantUml, `Diagram ${index + 1}`);
        } catch (error) {
            console.error(`Open PlantUML in new tab error for diagram ${index + 1}:`, error);
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showErrorMessage(`Failed to open PlantUML diagram: ${errorMsg}`);
        }
    };
}
