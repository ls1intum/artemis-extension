const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

/**
 * Plugin to copy CSS files from src/views to dist/views
 * @type {import('esbuild').Plugin}
 */
const copyCssPlugin = {
	name: 'copy-css',

	setup(build) {
		build.onEnd(() => {
			const viewsSrc = path.join(__dirname, 'src/views');
			const viewsDist = path.join(__dirname, 'dist/views');
			const baseCssSrc = path.join(__dirname, 'media/styles/base.css');
			const baseCssDist = path.join(__dirname, 'dist/base.css');

			// Ensure dist/views directory exists
			if (!fs.existsSync(viewsDist)) {
				fs.mkdirSync(viewsDist, { recursive: true });
			}

			// Copy base.css to dist/
			if (fs.existsSync(baseCssSrc)) {
				fs.copyFileSync(baseCssSrc, baseCssDist);
				console.log(`[copy-css] ${path.relative(__dirname, baseCssSrc)} -> ${path.relative(__dirname, baseCssDist)}`);
			}

			// Function to recursively copy CSS files
			function copyCssFiles(srcDir, destDir) {
				if (!fs.existsSync(srcDir)) {
					return;
				}

				const entries = fs.readdirSync(srcDir, { withFileTypes: true });

				for (const entry of entries) {
					const srcPath = path.join(srcDir, entry.name);
					const destPath = path.join(destDir, entry.name);

					if (entry.isDirectory()) {
						if (!fs.existsSync(destPath)) {
							fs.mkdirSync(destPath, { recursive: true });
						}
						copyCssFiles(srcPath, destPath);
					} else if (entry.isFile() && entry.name.endsWith('.css')) {
						fs.copyFileSync(srcPath, destPath);
						console.log(`[copy-css] ${path.relative(__dirname, srcPath)} -> ${path.relative(__dirname, destPath)}`);
					}
				}
			}

			copyCssFiles(viewsSrc, viewsDist);
		});
	},
};

async function main() {
	// Build extension (Node.js)
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			copyCssPlugin,
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		],
	});

	// Build webview components (Browser)
	const webviewCtx = await esbuild.context({
		entryPoints: [
			'src/views/webview/components.ts'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview-components.js',
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await extensionCtx.watch();
		await webviewCtx.watch();
	} else {
		await extensionCtx.rebuild();
		await webviewCtx.rebuild();
		await extensionCtx.dispose();
		await webviewCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
