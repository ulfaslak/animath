import type { AnimalInstance } from '../src/animals/types.js';
import { defaultStarter } from '../src/save.js';

/**
 * The authority's part in a test: the engine mints no ids ([[DECISIONS]] §
 * Engine), so a test that starts or restores a game gives the starter one.
 * `starter`, the literal id old saves hold, keeps tests about it readable.
 */
export const STARTER_ID = 'starter';

/** The default starter with the id a test's authority minted for it. */
export function testStarter(): AnimalInstance {
	return { ...defaultStarter(), id: STARTER_ID };
}

/** A test authority's `mintId` for `restoreGame`: always `STARTER_ID`. */
export function mint(): string {
	return STARTER_ID;
}

/**
 * A test authority's `mintId` that gives `ids` in order, one per call, and
 * throws when it has none left; `calls` counts the calls.
 */
export function mints(...ids: string[]): (() => string) & { calls: number } {
	const next = Object.assign(
		(): string => {
			const id = ids[next.calls++];
			if (id === undefined) throw new Error('mintId called more often than the test expects');
			return id;
		},
		{ calls: 0 }
	);
	return next;
}
