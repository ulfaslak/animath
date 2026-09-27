import {
	checkName,
	checkPassword,
	nameKey,
	saveLineage,
	saveSeq,
	validateSaveWrite
} from '@mathgame/engine';
import { randomInt } from 'node:crypto';
import { deleteUser, findUser, listAccounts, setPasswordHash } from './accounts.js';
import { env } from './env.js';
import { hashPassword, NO_PASSWORD } from './passwords.js';
import { SAVE_MAX_BYTES } from './save.js';
import {
	defaultExportFolder,
	describeSave,
	findSaves,
	openReadOnly,
	placeOf,
	PLAYER_ID,
	repositoryAround,
	stamp,
	storedName,
	writeExport,
	type SaveCandidate
} from './save-export.js';
import { createWelcomeAccount } from './welcome.js';

/**
 * What the admin CLI (`scripts/admin.ts`) does, as functions the tests call.
 * There is no email, so a forgotten password is reset here, by hand, and an
 * account is deleted here. A kid's game moves here from the server it was
 * played on before with `exportLocalSave` there and `importSave` here. Each
 * returns the lines to print.
 */

/** The `nameKey` of a name as the admin typed it, rules or not (`nameKey` tidies it). */
function keyOf(typed: string): string {
	return nameKey(typed);
}

/** Letters and digits that read the same to a kid: no 0/o, 1/l/i. */
const EASY = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A new password a parent can read out: six easy characters. */
export function easyPassword(): string {
	let password = '';
	for (let i = 0; i < 6; i++) password += EASY[randomInt(EASY.length)];
	return password;
}

export class AdminError extends Error {}

/**
 * Gives the account a new password (a made-up one when none is given) and
 * logs it out everywhere. With `secret` (the CLI's `--stdin`, which keeps a
 * password out of the process list and the host's `docker events`) the
 * password is not said back: whoever handed it in knows it.
 */
export async function resetPassword(
	typedName: string,
	newPassword?: string,
	options: { secret?: boolean } = {}
): Promise<string[]> {
	const user = await findUser(keyOf(typedName));
	if (!user) throw new AdminError(`No account is called "${typedName}".`);
	const password = newPassword ?? easyPassword();
	const checked = checkPassword(password);
	if (!checked.ok) {
		throw new AdminError(`That password is too ${checked.reason}: it needs 4 to 128 characters.`);
	}
	await setPasswordHash(user.id, await hashPassword(checked.password));
	return [
		options.secret && newPassword !== undefined
			? `A new password for ${user.name} is set.`
			: `New password for ${user.name}: ${password}`,
		'Every browser that was logged in to it is logged out.',
		...(user.passwordHash === NO_PASSWORD ? ['Its welcome link no longer works.'] : [])
	];
}

/**
 * Deletes the account, its sessions, its save and its set-aside saves. Without
 * `confirmed` it only says what it would delete.
 */
export async function deleteAccount(typedName: string, confirmed: boolean): Promise<string[]> {
	const user = await findUser(keyOf(typedName));
	if (!user) throw new AdminError(`No account is called "${typedName}".`);
	const summary = (await listAccounts()).find((a) => a.name === user.name);
	const about = summary
		? `${user.name}: made ${summary.createdAt.toISOString()}, ` +
			(summary.seq === null
				? 'no save'
				: `save seq ${summary.seq} from ${summary.savedAt?.toISOString()}`) +
			`, ${summary.sessions} browser(s) logged in`
		: user.name;
	if (!confirmed) {
		return [`Would delete ${about}.`, 'Run it again with --yes to delete it for good.'];
	}
	await deleteUser(user.id);
	return [`Deleted ${about}.`];
}

/** Every account, oldest first. */
export async function listAll(): Promise<string[]> {
	const accounts = await listAccounts();
	if (accounts.length === 0) return ['No accounts yet.'];
	return accounts.map(
		(a) =>
			`${a.name}\tmade ${a.createdAt.toISOString()}\t` +
			(a.seq === null ? 'no save' : `seq ${a.seq} at ${a.savedAt?.toISOString()}`) +
			`\t${a.sessions} logged in` +
			(a.hasPassword ? '' : '\tno password yet: its welcome link is waiting')
	);
}

/**
 * Which copy of a kid's game to export: the anonymous backup, the one
 * account found, or the account of that name (`account:<name>`).
 */
export type ExportFrom = 'anonymous' | 'account' | `account:${string}`;

/** Whether `text` is an `ExportFrom`, as the CLI's `--from` takes it. */
export function isExportFrom(text: string): text is ExportFrom {
	return text === 'anonymous' || text === 'account' || /^account:.+/s.test(text);
}

export interface ExportOptions {
	/** Which copy to take, in place of the one saved last. Needed when they are different games. */
	from?: ExportFrom;
	/** The folder the file goes in; `~/animath-exports` by default. */
	folder?: string;
	/** The database to read; the server's own (`DATABASE_URL`) by default. */
	databaseUrl?: string;
	now?: Date;
}

/**
 * The newest save of the player `playerId` in this server's database, to a
 * private file for `importSave` on the server the game moves to. The
 * database is only read, in a session that can do nothing else
 * (`openReadOnly`): the kid may be playing on it meanwhile. The player's
 * game can be in two places, the retired anonymous backup (so an old local
 * database: `save-export.ts`) and, once the kid has made an account here,
 * the account's save; each one found is listed, and
 * the one saved last is taken, or the one `from` names. Copies of two
 * different games (another lineage: a new game in the kid's account, or a
 * friend's account that took the name the kid had as a guest) are never
 * chosen between by time: nothing is written without `from`.
 */
export async function exportLocalSave(
	playerId: string,
	options: ExportOptions = {}
): Promise<string[]> {
	if (!PLAYER_ID.test(playerId)) {
		throw new AdminError(
			`"${playerId}" is not a player id: a uuid, as the kid's browser keeps it in animath.player.`
		);
	}
	const folder = options.folder ?? defaultExportFolder();
	const repository = repositoryAround(folder);
	if (repository) {
		throw new AdminError(
			`${folder} is inside the repository ${repository}: a kid's save goes to a folder outside any repository.`
		);
	}
	const reader = await openReadOnly(options.databaseUrl ?? env.DATABASE_URL);
	let found: SaveCandidate[];
	try {
		found = await findSaves(reader, playerId);
	} finally {
		await reader.end();
	}
	if (found.length === 0) {
		throw new AdminError(`The anonymous backup has no save for the player ${playerId}.`);
	}
	const lines = found.map(
		(c) => `Found ${placeOf(c)}: seq ${saveSeq(c.doc)}, saved ${stamp(c.savedAt)}.`
	);
	if (options.from === undefined && new Set(found.map((c) => saveLineage(c.doc))).size > 1) {
		throw new AdminError(
			[
				...lines,
				'These are different games, not copies of one, so nothing was written: an account may be',
				"another kid's who took this name. Check which one this kid plays now, and pick it with",
				'--from anonymous, --from account, or --from "account:<name>".'
			].join('\n')
		);
	}
	const chosen = chooseSave(found, options.from);
	lines.push(
		options.from
			? `Taking ${placeOf(chosen)}, as --from says.`
			: `Taking ${placeOf(chosen)}, the one saved last.`
	);
	const name = storedName(chosen.doc) ?? chosen.account ?? 'save';
	let file: string;
	try {
		file = await writeExport(chosen.doc, name, folder, options.now ?? new Date());
	} catch (error) {
		if ((error as { code?: unknown }).code !== 'EEXIST') throw error;
		throw new AdminError(`An export of that name is there already: run it again in a second.`);
	}
	lines.push(`${describeSave(chosen.doc, chosen.savedAt)} → ${file}`);
	return lines;
}

/** The candidate `from` names, else the one saved last. */
function chooseSave(found: SaveCandidate[], from?: ExportFrom): SaveCandidate {
	if (from === undefined) return found.at(-1)!;
	const named = from.startsWith('account:') ? nameKey(from.slice('account:'.length)) : null;
	const matching = found.filter((c) =>
		named === null
			? c.place === from
			: c.place === 'account' && c.account !== undefined && nameKey(c.account) === named
	);
	if (matching.length === 0) {
		throw new AdminError(
			from === 'anonymous'
				? 'The anonymous backup has no save for this player.'
				: named === null
					? 'No account here holds this game: take the anonymous backup (--from anonymous).'
					: `No account found for this game is called "${from.slice('account:'.length)}".`
		);
	}
	if (matching.length > 1) {
		throw new AdminError(
			`Several accounts hold games of this player (${matching.map((c) => c.account).join(', ')}): pick one with --from "account:<name>".`
		);
	}
	return matching[0]!;
}

export interface ImportOptions {
	/** The account's name, in place of the save's own. The character takes it too. */
	name?: string;
	/** The game's address for the link, in place of `https://<domain>`. */
	origin?: string;
	/** The game's domain (`MATHGAME_DOMAIN`, as `deploy.env` sets it). */
	domain?: string;
}

/** Where the welcome link points: `--origin`, else the configured domain over HTTPS. */
function linkOrigin({ origin, domain }: ImportOptions): string {
	if (origin !== undefined) {
		let url: URL;
		try {
			url = new URL(origin);
		} catch {
			throw new AdminError(`--origin ${origin} is not an address like https://example.com.`);
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			throw new AdminError(`--origin ${origin} is not an http or https address.`);
		}
		return url.origin;
	}
	if (domain) {
		let url: URL | null = null;
		try {
			url = new URL(`https://${domain}`);
		} catch {
			url = null;
		}
		if (!url || url.host !== domain.toLowerCase()) {
			throw new AdminError(`MATHGAME_DOMAIN=${domain} is not a domain like animath.example.`);
		}
		return url.origin;
	}
	throw new AdminError(
		'The link needs the game’s address: set MATHGAME_DOMAIN (deploy.env holds it), or pass --origin <address>.'
	);
}

/** What `checkName` asks of a name, for the admin. */
const NAME_RULE =
	'2 to 16 letters or numbers, words joined by single spaces or hyphens, and nothing rude';

/**
 * A kid's save (`exportLocalSave`'s file, as `text`) becomes an account
 * here: named as the save's player (or `name`), holding the save with that
 * name on it, with no password, and a welcome link that lets the kid pick
 * one and play ([[DECISIONS]] § Accounts). The save is checked and upgraded
 * by the engine, as a registration's is. Nothing is made when anything is
 * wrong, a taken name included.
 */
export async function importSave(text: string, options: ImportOptions = {}): Promise<string[]> {
	// Before anything is made: a link with nowhere to go would be no link.
	const origin = linkOrigin(options);
	let doc: unknown;
	try {
		doc = JSON.parse(text);
	} catch {
		throw new AdminError('That is not JSON: pipe in the file export-local-save wrote.');
	}
	const checked = validateSaveWrite(doc);
	if (!checked.ok) {
		throw new AdminError(
			checked.reason === 'newer'
				? `A newer version of the game wrote this save (${checked.error}): deploy that version here first.`
				: `This is not a save the game can play: ${checked.error}.`
		);
	}
	const typed = options.name ?? checked.value.name;
	if (typed === undefined) {
		throw new AdminError('This save has no name yet: give the account one with --name <name>.');
	}
	const named = checkName(typed);
	if (!named.ok) {
		throw new AdminError(
			`"${typed}" cannot be a name (${named.reason}): ${NAME_RULE}. Pick one with --name <name>.`
		);
	}
	const save = { ...checked.value, name: named.name };
	if (Buffer.byteLength(JSON.stringify(save), 'utf8') > SAVE_MAX_BYTES) {
		throw new AdminError(`This save is bigger than ${SAVE_MAX_BYTES} bytes, the most one can be.`);
	}
	const key = nameKey(named.name);
	const made = await createWelcomeAccount({ name: named.name, nameKey: key, save });
	if (!made) {
		const taken = await findUser(key);
		const waiting =
			taken?.passwordHash === NO_PASSWORD
				? ` It has no password yet: an earlier import whose link was never used. To make a new link for it, delete it (delete-account "${taken.name}" --yes) and import again.`
				: '';
		throw new AdminError(
			`An account is already called "${taken?.name ?? named.name}". Pick another name with --name <name>; the character takes it too.${waiting}`
		);
	}
	return [
		`Made the account ${named.name}, with no password yet: ${describeSave(save)}.`,
		`Its welcome link works once, until ${stamp(made.expiresAt)}:`,
		// After `#`, which a browser never sends: the token is in no request line, and so in no
		// server's log, nginx's error log included, whatever happens while the kid opens it.
		`${origin}/#welcome=${made.token}`
	];
}
