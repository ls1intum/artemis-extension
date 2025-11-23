/**
 * Processes PlantUML text by replacing all testsColor(...) patterns with "green".
 * Handles nested parentheses so calls like testsColor(test(a(b(c)))) are fully replaced.
 */

/**
 * Process PlantUML text and replace all testsColor patterns with "green"
 * @param plantUml The PlantUML text to process
 * @returns Processed PlantUML text with all testsColor(...) replaced with "green"
 */
export function processPlantUml(plantUml: string): string {
    const marker = 'testsColor(';
    let result = '';
    let cursor = 0;

    while (cursor < plantUml.length) {
        const start = plantUml.indexOf(marker, cursor);
        if (start === -1) {
            result += plantUml.slice(cursor);
            break;
        }

        // Add everything before the match untouched
        result += plantUml.slice(cursor, start);

        // Find the matching closing parenthesis, accounting for nesting
        const openIndex = start + marker.length;
        let depth = 1;
        let end = -1;

        for (let i = openIndex; i < plantUml.length; i++) {
            const char = plantUml[i];
            if (char === '(') {
                depth++;
            } else if (char === ')') {
                depth--;
                if (depth === 0) {
                    end = i;
                    break;
                }
            }
        }

        if (end === -1) {
            // No matching closing parenthesis, leave the rest unchanged
            result += plantUml.slice(start);
            break;
        }

        // Replace the matched block with green and continue scanning
        result += 'green';
        cursor = end + 1;
    }

    return result;
}
