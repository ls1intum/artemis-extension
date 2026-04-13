const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const cssModulesPlugin = require('esbuild-css-modules-plugin');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const formatSize = (bytes) => {
	const kb = bytes / 1024;
	const mb = kb / 1024;
	return mb >= 1 ? `${mb.toFixed(2)} MB` : `${kb.toFixed(2)} KB`;
};

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

/** Copy KaTeX static assets (JS, CSS, fonts) to dist/katex/ for webview use */
function copyKatexAssets() {
	const src = path.join(__dirname, 'node_modules/katex/dist');
	const dest = path.join(__dirname, 'dist/katex');
	fs.mkdirSync(dest, { recursive: true });
	fs.mkdirSync(path.join(dest, 'fonts'), { recursive: true });
	fs.copyFileSync(path.join(src, 'katex.min.js'), path.join(dest, 'katex.min.js'));
	fs.copyFileSync(path.join(src, 'katex.min.css'), path.join(dest, 'katex.min.css'));
	for (const font of fs.readdirSync(path.join(src, 'fonts'))) {
		if (font.endsWith('.woff2')) {
			fs.copyFileSync(path.join(src, 'fonts', font), path.join(dest, 'fonts', font));
		}
	}
}

async function main() {
	// Copy KaTeX assets before build
	copyKatexAssets();

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
		metafile: true,
		plugins: [
			esbuildProblemMatcherPlugin,
		],
	});

	// Build React webview (Browser)
	const webviewReactCtx = await esbuild.context({
		entryPoints: [
			'src/webview/index.tsx'
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
			'.css': 'css',
			'.woff': 'file',
			'.woff2': 'file',
			'.ttf': 'file'
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
		const extensionResult = await extensionCtx.rebuild();
		const webviewResult = await webviewReactCtx.rebuild();

		// Write metafiles for bundle analysis
		if (webviewResult.metafile) {
			await fs.promises.writeFile(
				path.join(__dirname, 'dist/meta-webview.json'),
				JSON.stringify(webviewResult.metafile)
			);
		}
		if (extensionResult.metafile) {
			await fs.promises.writeFile(
				path.join(__dirname, 'dist/meta-extension.json'),
				JSON.stringify(extensionResult.metafile)
			);
		}

		// Report bundle sizes
		const extStats = fs.statSync(path.join(__dirname, 'dist/extension.js'));
		const webviewStats = fs.statSync(path.join(__dirname, 'dist/webview-react.js'));
		console.log(`[build] extension.js: ${formatSize(extStats.size)}`);
		console.log(`[build] webview-react.js: ${formatSize(webviewStats.size)}`);
		console.log(`[build] Total: ${formatSize(extStats.size + webviewStats.size)}`);

		await extensionCtx.dispose();
		await webviewReactCtx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
