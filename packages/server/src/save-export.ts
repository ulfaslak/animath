import { nameKey, readSave, saveLineage, saveSeq, type AnimalInstance } from '@mathgame/engine';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';

/**
 * The pieces of `admin export-local-save` (`admin.ts`): finding a kid's
 * newest save in the database this machine played on, strictly read-only,
 * and writing it to a private file that `admin import-save` takes on the
 * server the game moves to ([[DEVELOPMENT]] § Moving a kid's game to
 * production).
 */

/** Rows for one statement: all the export ever asks a database. */
export interface Reader {
	rows(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

/**
 * A session on `url` that can only read: its first statement is `SET
 * default_transaction_read_only = on`, checked before anything else runs,
 * and every statement after it is a read. The kid may be playing on this
 * database while the export runs.
 */
export async function openReadOnly(url: string): Promise<Reader & { end(): Promise<void> }> {
	const client = new pg.Client({ connectionString: url });
	await client.connect();
	try {
		await client.query('SET default_transaction_read_only = on');
		const shown = await client.query('SHOW default_transaction_read_only');
		if (shown.rows[0]?.default_transaction_read_only !== 'on') {
			throw new Error('the session did not become read-only');
		}
	} catch (error) {
		await client.end();
		throw error;
	}
	return {
		rows: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
		end: () => client.end()
	};
}

/** A save the export can take: the anonymous backup's, or an account's. */
export interface SaveCandidate {
	place: 'anonymous' | 'account';
	/** The account's name, for an account's save. */
	account?: string;
	/** The document as stored. */
	doc: unknown;
	savedAt: Date;
}

/** A player id as the anonymous backup keeps it. */
export const PLAYER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `name` a stored document holds, whatever its version; null for none. */
export function storedName(doc: unknown): string | null {
	const name =
		typeof doc === 'object' && doc !== null ? (doc as Record<string, unknown>).name : undefined;
	return typeof name === 'string' ? name : null;
}

/**
 * Where a player's newest save can be: the anonymous backup (`saves`, by the
 * player's id) and, when this database has accounts, the saves of the
 * accounts that hold that game: the one named as the backup's player is
 * (`name_key`), and any whose save is the same game (its `lineage`), for a
 * kid who changed the name as the account was made. Oldest first. Empty
 * when the anonymous backup has nothing for the player.
 */
export async function findSaves(db: Reader, playerId: string): Promise<SaveCandidate[]> {
	const [backup] = await db.rows('select data, updated_at from saves where player_id = $1', [
		playerId
	]);
	if (!backup) return [];
	const found: SaveCandidate[] = [
		{ place: 'anonymous', doc: backup.data, savedAt: backup.updated_at as Date }
	];
	const [tables] = await db.rows(
		"select to_regclass('public.users') is not null and to_regclass('public.account_saves') is not null as accounts"
	);
	if (tables?.accounts !== true) return found;
	const name = storedName(backup.data);
	const accounts = await db.rows(
		`select u.name, s.data, s.updated_at
		   from account_saves s join users u on u.id = s.user_id
		  where u.name_key = $1 or ($2 <> '' and s.data->>'lineage' = $2)
		  order by s.updated_at, u.name`,
		[name === null ? null : nameKey(name), saveLineage(backup.data)]
	);
	for (const row of accounts) {
		found.push({
			place: 'account',
			account: row.name as string,
			doc: row.data,
			savedAt: row.updated_at as Date
		});
	}
	return found.sort((a, b) => a.savedAt.getTime() - b.savedAt.getTime());
}

/** Where a candidate was found, in words. */
export function placeOf(candidate: SaveCandidate): string {
	return candidate.place === 'anonymous'
		? 'the anonymous backup'
		: `the account "${candidate.account}"`;
}

/** A moment as the admin reads it: `2026-09-27 12:47:01 UTC`. */
export function stamp(at: Date): string {
	return `${at.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** The team by kind, in party order: `whale, frog ×2, rabbit "nini"`. */
function kinds(party: readonly AnimalInstance[]): string {
	const bySpecies = new Map<string, { count: number; nicknames: string[] }>();
	for (const animal of party) {
		const kind = bySpecies.get(animal.speciesId) ?? { count: 0, nicknames: [] };
		kind.count++;
		if (animal.nickname) kind.nicknames.push(`"${animal.nickname}"`);
		bySpecies.set(animal.speciesId, kind);
	}
	return [...bySpecies]
		.map(
			([species, { count, nicknames }]) =>
				`${species}${count > 1 ? ` ×${count}` : ''}${nicknames.length > 0 ? ` ${nicknames.join(' ')}` : ''}`
		)
		.join(', ');
}

/**
 * A save in one line: the name, the team (how many, and which), the tokens
 * and tools, where the player is, its `seq`, and when it was saved, when
 * that is known.
 */
export function describeSave(doc: unknown, savedAt?: Date): string {
	const saved = savedAt ? `, saved ${stamp(savedAt)}` : '';
	const read = readSave(doc);
	if (!read.ok) {
		return `a save this build cannot read (${read.reason}: ${read.error}), seq ${saveSeq(doc)}${saved}`;
	}
	const save = read.save;
	const items = save.items?.length ? save.items.join(', ') : 'no tools';
	return (
		`${save.name ?? '(no name)'}: ${save.party.length} animals (${kinds(save.party)}), ` +
		`${save.tokens ?? 0} tokens, ${items}, World ${save.world} at ${save.pos.x},${save.pos.y}, ` +
		`seq ${save.seq ?? 0}${saved}`
	);
}

/** Where exports go unless told otherwise: private, and outside any repository. */
export function defaultExportFolder(): string {
	return join(homedir(), 'animath-exports');
}

/** The repository `path` is in (the nearest folder at or above it holding `.git`), or null. */
export function repositoryAround(path: string): string | null {
	for (let folder = resolve(path); ; folder = dirname(folder)) {
		if (existsSync(join(folder, '.git'))) return folder;
		if (dirname(folder) === folder) return null;
	}
}

/**
 * Writes `doc` as it was stored to `<folder>/<name>-<when>.json`, readable by
 * its owner alone (0600), never over a file that is there. The folder is
 * made, 0700, when it is missing. The caller has checked it is outside any
 * repository.
 */
export async function writeExport(
	doc: unknown,
	name: string,
	folder: string,
	now: Date
): Promise<string> {
	await mkdir(folder, { recursive: true, mode: 0o700 });
	const safe = name.normalize('NFC').replace(/[^\p{L}\p{N}-]+/gu, '-') || 'save';
	const when = now.toISOString().slice(0, 19).replace(/[-:]/g, '');
	const file = join(resolve(folder), `${safe}-${when}Z.json`);
	await writeFile(file, `${JSON.stringify(doc, null, '\t')}\n`, { flag: 'wx', mode: 0o600 });
	await chmod(file, 0o600);
	return file;
}
