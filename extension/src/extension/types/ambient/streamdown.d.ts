// Streamdown is ESM but TypeScript Node16 resolution complains
// Re-export the actual types from streamdown package to resolve TS1479 in imports
declare module "streamdown" {
	export * from "streamdown/dist/index";
}
