import * as fs from 'fs';
import * as path from 'path';

/**
 * Gets the base directory for views.
 * Handles multiple scenarios:
 * - Development with source maps: __dirname = src/views/utils
 * - Bundled extension: __dirname = dist (where extension.js is)
 * - Test environment: various locations
 */
function getViewsBaseDir(): string {
    // Check if we're in the src/views directory structure (development)
    const currentDir = __dirname;
    
    // Case 1: __dirname is in src/views/... (development mode)
    // e.g., /path/to/project/src/views/utils
    if (currentDir.includes(path.join('src', 'views'))) {
        // Navigate up to src/views
        const srcViewsIndex = currentDir.indexOf(path.join('src', 'views'));
        return currentDir.substring(0, srcViewsIndex + path.join('src', 'views').length);
    }
    
    // Case 2: __dirname is dist/ (bundled mode)
    // e.g., /path/to/project/dist
    const distViewsPath = path.join(currentDir, 'views');
    if (fs.existsSync(distViewsPath)) {
        return distViewsPath;
    }
    
    // Case 3: Try going up one level and looking for dist/views
    const parentDistViewsPath = path.join(currentDir, '..', 'views');
    if (fs.existsSync(parentDistViewsPath)) {
        return path.resolve(parentDistViewsPath);
    }
    
    // Case 4: Try going up to find src/views
    const parentSrcViewsPath = path.join(currentDir, '..', 'src', 'views');
    if (fs.existsSync(parentSrcViewsPath)) {
        return path.resolve(parentSrcViewsPath);
    }
    
    // Fallback: return dist/views relative to current directory
    return distViewsPath;
}

/**
 * Loads the base CSS file that contains global styles and CSS variables.
 * @returns Base CSS content as string
 */
function loadBaseCss(): string {
    const currentDir = __dirname;
    
    // Try multiple locations for base.css
    const possiblePaths = [
        // Development: media/styles/base.css
        path.join(currentDir, '../../..', 'media', 'styles', 'base.css'),
        // Bundled: dist/base.css
        path.join(currentDir, '..', 'base.css'),
        path.join(currentDir, 'base.css'),
    ];
    
    for (const baseCssPath of possiblePaths) {
        if (fs.existsSync(baseCssPath)) {
            try {
                return fs.readFileSync(baseCssPath, 'utf-8');
            } catch (error) {
                console.error(`[cssLoader] Failed to read base.css from ${baseCssPath}`, error);
            }
        }
    }
    
    console.warn('[cssLoader] base.css not found in any expected location');
    return '';
}

function readCssContent(relativePath: string): string {
    const viewsDir = getViewsBaseDir();
    const cssPath = path.join(viewsDir, relativePath);
    
    try {
        return fs.readFileSync(cssPath, 'utf-8');
    } catch (error) {
        console.error(`[cssLoader] Failed to load CSS file: ${cssPath}`, error);
        console.error(`[cssLoader] __dirname: ${__dirname}`);
        console.error(`[cssLoader] Views base dir: ${viewsDir}`);
        console.error(`[cssLoader] Relative path: ${relativePath}`);
        return '';
    }
}

/**
 * Reads one or more CSS files and combines them into a single string.
 * Automatically includes base.css at the beginning.
 * 
 * @param relativePaths - Array of paths relative to src/views
 * @returns Combined CSS content as string
 */
export function readCssFiles(...relativePaths: string[]): string {
    if (relativePaths.length === 0) {
        return loadBaseCss();
    }
    
    // Load base CSS once
    const baseCss = loadBaseCss();
    
    // Load all other CSS files
    const viewCss = relativePaths
        .map(relativePath => readCssContent(relativePath))
        .filter(Boolean)
        .join('\n');
    
    return baseCss ? `${baseCss}\n\n${viewCss}` : viewCss;
}
