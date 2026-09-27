import { checkPassword } from '@mathgame/engine';
import { randomInt } from 'node:crypto';
import { deleteUser, findUser, listAccounts, setPasswordHash } from './accounts.js';
import { checkName, nameKey } from './names-stub.js';
import { hashPassword } from './passwords.js';

/**
 * What the admin CLI (`scripts/admin.ts`) does, as functions the tests call.
 * There is no email, so a forgotten password is reset here, by hand, and an
 * account is deleted here. Each returns the lines to print.
 */

/** The `nameKey` of a name as the admin typed it, rules or not. */
function keyOf(typed: string): string {
	const checked = checkName(typed);
	return nameKey(checked.ok ? checked.name : typed.trim().normalize('NFC'));
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

/** Gives the account a new password (a made-up one when none is given) and logs it out everywhere. */
export async function resetPassword(typedName: string, newPassword?: string): Promise<string[]> {
	const user = await findUser(keyOf(typedName));
	if (!user) throw new AdminError(`No account is called "${typedName}".`);
	const password = newPassword ?? easyPassword();
	const checked = checkPassword(password);
	if (!checked.ok) {
		throw new AdminError(`That password is too ${checked.reason}: it needs 4 to 128 characters.`);
	}
	await setPasswordHash(user.id, await hashPassword(checked.password));
	return [
		`New password for ${user.name}: ${password}`,
		'Every browser that was logged in to it is logged out.'
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
			`\t${a.sessions} logged in`
	);
}
