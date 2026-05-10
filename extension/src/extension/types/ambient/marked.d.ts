// marked v17+ is ESM-only but TypeScript Node16 resolution complains (TS1479).
// esbuild handles the actual bundling fine; this shim satisfies the type checker.
declare module "marked" {
	export function marked(src: string, options?: { async?: false }): string;
	export function marked(src: string, options: { async: true }): Promise<string>;
	export namespace marked {
		function use(options: { async?: boolean }): void;
		function parse(src: string, options?: { async?: false }): string;
		function parse(src: string, options: { async: true }): Promise<string>;
	}
}
