const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const cssModulesPlugin = require('esbuild-css-modules-plugin');

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

async function main() {
	// Dynamic import for ESM-only package
	const { default: inlineWorkerPlugin } = await import('esbuild-plugin-inline-worker');

	// Build extension (Node.js)
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: true,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Build React webview (Browser)
	const webviewReactCtx = await esbuild.context({
		entryPoints: [
			'src/views/webview/react/index.tsx'
		],
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: true,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview-react.js',
		metafile: true,
		loader: {
			'.tsx': 'tsx',
			'.ts': 'ts',
			'.css': 'css'
		},
		define: {
			'process.env.NODE_ENV': production ? '"production"' : '"development"'
		},
		logLevel: 'silent',
		plugins: [
			inlineWorkerPlugin(),
			cssModulesPlugin(),
			esbuildProblemMatcherPlugin,
		],
	});

	if (watch) {
		await extensionCtx.watch();
		await webviewReactCtx.watch();
	} else {
		await extensionCtx.rebuild();
		const webviewResult = await webviewReactCtx.rebuild();

		// Write metafile for bundle analysis in production builds
		if (production && webviewResult.metafile) {
			await fs.promises.writeFile(
				path.join(__dirname, 'dist/meta.json'),
				JSON.stringify(webviewResult.metafile)
			);
			console.log('[build] Generated bundle analysis metadata at dist/meta.json');
		}

		await extensionCtx.dispose();
		await webviewReactCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
