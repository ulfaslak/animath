/**
 * An account's password: the rule the client shows while a kid types and the
 * server enforces. Kid-friendly on purpose: four characters are enough, since
 * the account only keeps a game's animals safe and holds nothing personal.
 */

/** The fewest characters a password may have. */
export const PASSWORD_MIN_LENGTH = 4;
/**
 * The most characters a password may have. It bounds the work a login does:
 * a password is hashed with a deliberately slow function.
 */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Raw input past this many UTF-16 units is never normalized: a character is
 * at most two units, and NFC turns one into at most three characters, so no
 * password that fits `PASSWORD_MAX_LENGTH` is longer.
 */
const MAX_RAW_LENGTH = PASSWORD_MAX_LENGTH * 6;

export type PasswordRefusal = 'short' | 'long';

export type PasswordCheck = { ok: true; password: string } | { ok: false; reason: PasswordRefusal };

/**
 * Checks a typed password. On success `password` is the text to hash: NFC,
 * so an "å" typed as one character on a laptop and as "a" plus a ring on a
 * tablet is the same password. Nothing else changes: spaces count, and a
 * password is never trimmed. Its length is counted in characters (code
 * points), so "æøå1" has four.
 */
export function checkPassword(raw: string): PasswordCheck {
	if (raw.length > MAX_RAW_LENGTH) return { ok: false, reason: 'long' };
	const password = raw.normalize('NFC');
	let length = 0;
	for (const _ of password) length++;
	if (length < PASSWORD_MIN_LENGTH) return { ok: false, reason: 'short' };
	if (length > PASSWORD_MAX_LENGTH) return { ok: false, reason: 'long' };
	return { ok: true, password };
}
