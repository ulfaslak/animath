/**
 * A `.yaml` import is the file's data, parsed at build time by the plugin in
 * `vite.config.ts`. Its shape is whatever the file holds, so it is `unknown`
 * until the importer checks or narrows it.
 */
declare module '*.yaml' {
	const data: unknown;
	export default data;
}
