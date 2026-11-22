import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A rule about the hand-written migrations that nothing else would catch
// before a kid's game did.

const folder = fileURLToPath(new URL('../drizzle/', import.meta.url));
const files = readdirSync(folder)
	.filter((f) => f.endsWith('.sql'))
	.sort();
const journal = JSON.parse(readFileSync(`${folder}meta/_journal.json`, 'utf8')) as {
	entries: { idx: number; tag: string; when: number }[];
};

describe('migrations', () => {
	it('every .sql file has a journal entry, in order, with a later `when` than the one before', () => {
		// The migrator applies only journaled files, and only when their `when` is
		// later than the last applied one; anything else is skipped in silence.
		expect(journal.entries.map((e) => `${e.tag}.sql`)).toEqual(files);
		journal.entries.forEach((entry, i) => {
			expect(entry.idx).toBe(i);
			if (i > 0) expect(entry.when).toBeGreaterThan(journal.entries[i - 1]!.when);
		});
	});
});
