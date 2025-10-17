/**
 * Processes PlantUML text by replacing all testsColor(...) patterns with "green"
 * 
 * This regex matches patterns like:
 * - testsColor(<testid>309795</testid>)
 * - testsColor(testCalculateMaxVelocity())
 * And replaces them all with "green"
 * 
 * The regex handles nested parentheses by matching until the LAST closing paren
 */

// Regex to match testsColor(...) with any content inside, including nested parentheses
const testsColorRegex = /testsColor\([^)]*(?:\([^)]*\)[^)]*)*\)/g;

/**
 * Process PlantUML text and replace all testsColor patterns with "green"
 * @param plantUml The PlantUML text to process
 * @returns Processed PlantUML text with all testsColor(...) replaced with "green"
 */
export function processPlantUml(plantUml: string): string {
    return plantUml.replace(testsColorRegex, 'green');
}
