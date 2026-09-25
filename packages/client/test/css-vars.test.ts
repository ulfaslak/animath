import { describe, expect, it } from 'vitest';

/**
 * Every CSS custom property the UI reads is defined. `var(--battle-panel)`
 * with no definition is not an error anywhere — svelte-check, the build and
 * the browser all accept it — and the element silently loses its height or
 * colour. The battle panel's first pass shipped exactly that, green, until a
 * screenshot showed it. Definitions live on `:root` in `styles.css`
 * (see DESIGN § Palette).
 */
const sources = import.meta.glob(['../src/**/*.svelte', '../src/**/*.css'], {
	query: '?raw',
	import: 'default',
	eager: true
}) as Record<string, string>;

describe('CSS custom properties', () => {
	it('every var(--x) the UI reads is defined', () => {
		const defined = new Set<string>();
		const used = new Map<string, string>();
		for (const [file, text] of Object.entries(sources)) {
			for (const m of text.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]!);
			for (const m of text.matchAll(/var\(\s*(--[\w-]+)/g)) used.set(m[1]!, file);
		}
		expect(Object.keys(sources).length).toBeGreaterThan(3);
		const missing = [...used].filter(([name]) => !defined.has(name));
		expect(missing).toEqual([]);
	});
});
