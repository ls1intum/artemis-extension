// streamdown references mermaid as an optional dependency
// This project does not use mermaid directly: the declaration prevents TS2307
declare module "mermaid" {
	const mermaid: unknown;
	export default mermaid;
}

// Streamdown is ESM but TypeScript Node16 resolution complains
// Re-export the actual types from streamdown package to resolve TS1479 in imports
declare module "streamdown" {
	export * from "streamdown/dist/index";
}
