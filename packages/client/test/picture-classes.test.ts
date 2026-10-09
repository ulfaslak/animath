import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ui = fileURLToPath(new URL('../src/ui/', import.meta.url));

/** Every class name a component's markup gives, as written (`class="a b"`, `class:x`). */
function classesIn(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(/class="([^"]*)"/g)) {
		for (const name of m[1]!.split(/\s+/)) if (/^[a-z][a-z0-9-]*$/.test(name)) names.add(name);
	}
	for (const m of source.matchAll(/class:([a-z][a-z0-9-]*)/g)) names.add(m[1]!);
	return names;
}

describe("a puzzle's picture", () => {
	it('uses no class name a card styles from outside (`:global`), which would reach into the picture', () => {
		// The druid's card hid every `.note` in its puzzle, the help line it meant and the
		// kroner picture's banknotes too: the fare showed 32 kroner of 82, and 32 was "wrong".
		const reaching = new Set<string>();
		for (const file of readdirSync(ui).filter((f) => f.endsWith('.svelte'))) {
			const source = readFileSync(join(ui, file), 'utf8');
			for (const m of source.matchAll(/:global\(\.([a-z][a-z0-9-]*)\)/g)) reaching.add(m[1]!);
		}
		const pictures = join(ui, 'pictures');
		const clashes: string[] = [];
		for (const file of readdirSync(pictures).filter((f) => f.endsWith('.svelte'))) {
			for (const name of classesIn(readFileSync(join(pictures, file), 'utf8'))) {
				if (reaching.has(name)) clashes.push(`${file}: .${name}`);
			}
		}
		expect(reaching.has('note')).toBe(true);
		expect(clashes).toEqual([]);
	});
});
