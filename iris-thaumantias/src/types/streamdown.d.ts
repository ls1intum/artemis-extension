// streamdown references mermaid as an optional dependency
// This project does not use mermaid directly — declaration prevents TS2307
declare module "mermaid" {
	const mermaid: unknown;
	export default mermaid;
}
