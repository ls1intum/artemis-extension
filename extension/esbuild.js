const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const cssModulesPlugin = require('esbuild-css-modules-plugin');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const { resolveBuildVariant } = require('./scripts/resolveBuildVariant');
const { variant, isOpenVsx, recording } = resolveBuildVariant({ argv: process.argv, env: process.env });
const recordingEnabled = String(recording);
const telemetryEnabled = String(!isOpenVsx);
const seamAliases = {
    '@dataCollection': path.join(__dirname, recording
        ? 'src/extension/dataCollection/recording.ts'
        : 'src/extension/dataCollection/noop.ts'),
    '@telemetry': path.join(__dirname, isOpenVsx
        ? 'src/extension/telemetry/noop.ts'
        : 'src/extension/telemetry/index.ts'),
};
const webviewAliases = {
    '@struggleView': path.join(__dirname, isOpenVsx
        ? 'src/webview/views/StruggleDetection/stub.tsx'
        : 'src/webview/views/StruggleDetection/index.ts'),
};
console.log(`[build] variant: ${variant} (recording=${recording})`);

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

async function main() {
	// Dynamic import for ESM-only package
	const { default: inlineWorkerPlugin } = await import('esbuild-plugin-inline-worker');

	// Build extension (Node.js)
	const extensionCtx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		tsconfig: path.join(__dirname, 'tsconfig.json'),
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: true,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		alias: seamAliases,
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
		tsconfig: path.join(__dirname, 'tsconfig.json'),
		bundle: true,
		format: 'iife',
		minify: production,
		sourcemap: true,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview-react.js',
		metafile: true,
		alias: webviewAliases,
		loader: {
			'.tsx': 'tsx',
			'.ts': 'ts',
			'.css': 'css',
			'.woff': 'file',
			'.woff2': 'file',
			'.ttf': 'file'
		},
		define: {
			'process.env.NODE_ENV': production ? '"production"' : '"development"',
			'__IRIS_RECORDING__': recordingEnabled,
			'__IRIS_TELEMETRY__': telemetryEnabled,
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
		const metaSuffix = isOpenVsx ? '-openvsx' : '';
		if (webviewResult.metafile) {
			await fs.promises.writeFile(
				path.join(__dirname, `dist/meta-webview${metaSuffix}.json`),
				JSON.stringify(webviewResult.metafile)
			);
		}
		if (extensionResult.metafile) {
			await fs.promises.writeFile(
				path.join(__dirname, `dist/meta-extension${metaSuffix}.json`),
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
