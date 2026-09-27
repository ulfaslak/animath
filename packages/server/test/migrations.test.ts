import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Two rules about the hand-written migrations that nothing else would catch
// before a kid's game did.

const folder = fileURLToPath(new URL('../drizzle/', import.meta.url));
const files = readdirSync(folder)
	.filter((f) => f.endsWith('.sql'))
	.sort();
const journal = JSON.parse(readFileSync(`${folder}meta/_journal.json`, 'utf8')) as {
	entries: { idx: number; tag: string; when: number }[];
};

/** The migrations that were on main when the anonymous backup held a real kid's game. */
const BACKUP_ERA = ['0000_players_and_saves', '0001_players_secret_hash', '0002_save_backups'];
/** The anonymous backup's tables. */
const BACKUP_TABLES = ['players', 'saves', 'save_backups'];

/** A statement that changes one of those tables, its rows or its index. */
const TABLE = `"?(?:public"?\\.)?"?(?:${BACKUP_TABLES.join('|')})"?(?![a-z_])`;
const TOUCHES = new RegExp(
	[
		`(?:alter|drop|truncate)\\s+table\\s+(?:if\\s+exists\\s+)?(?:only\\s+)?${TABLE}`,
		`(?:delete\\s+from|update)\\s+(?:only\\s+)?${TABLE}`,
		`insert\\s+into\\s+${TABLE}`,
		`drop\\s+index\\s+(?:if\\s+exists\\s+)?"?save_backups_player_id_idx"?`
	].join('|')
);

/** The SQL with comments removed, lower case, whitespace collapsed. */
function statements(file: string): string {
	return readFileSync(`${folder}${file}`, 'utf8')
		.replace(/--.*$/gm, '')
		.replace(/\/\*[\s\S]*?\*\//g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ');
}

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

	it('no migration after the anonymous backup shipped drops, alters or empties its tables', () => {
		// players, saves and save_backups hold the retired anonymous backup's games:
		// in the human's local database, the tunnel's, which the export still reads.
		// They go only with the migration DEFERRED's trigger allows, and this with them.
		const later = files.filter((f) => !BACKUP_ERA.includes(f.replace(/\.sql$/, '')));
		expect(later.length).toBeGreaterThan(0);
		for (const file of later) expect(statements(file), file).not.toMatch(TOUCHES);
	});

	it('the guard sees the statements it is there to stop, and only those', () => {
		for (const sql of [
			'alter table "players" add column x int',
			'drop table if exists saves',
			'truncate table public.save_backups',
			'delete from "saves" where true',
			'update players set display_name = null',
			'insert into save_backups (player_id) values (null)',
			'drop index if exists "save_backups_player_id_idx"'
		]) {
			expect(sql, sql).toMatch(TOUCHES);
		}
		for (const sql of [
			'create table if not exists "account_saves" (x int)',
			'alter table "users" add column x int',
			'drop table if exists account_save_backups',
			'update account_saves set seq = 1'
		]) {
			expect(sql, sql).not.toMatch(TOUCHES);
		}
	});
});
