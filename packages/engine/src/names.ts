import { MAX_MARKS_PER_LETTER, belongsOn } from './party/names.js';

/**
 * A player's name ([[PRODUCT]] §4 "Starting out"): what other kids see above
 * the player's character, and their username once they make an account. The
 * one rule for it, which the client asks before it sends a name and every
 * authority and the server ask again.
 *
 * A name is the text typed with white space trimmed from both ends, any run
 * of white space inside it made one space, and NFC applied (an accent typed
 * as its own mark joins its letter). Then it must be:
 *
 * - `MIN_NAME_LENGTH` to `MAX_NAME_LENGTH` characters long (code points, so
 *   a mark on a letter counts as one);
 * - letters of any alphabet (æ, ø and å among them, with the accents a
 *   letter of its script takes: `belongsOn`, as for a nickname) and digits,
 *   in words joined by single spaces or hyphens: nothing else, and never a
 *   space or a hyphen first, last or twice in a row;
 * - free of the rude words below, in English and Danish.
 *
 * `checkName` says which of these a name fails, first failure first, as a
 * code the client words kindly.
 */

/** The fewest characters a name has. */
export const MIN_NAME_LENGTH = 2;
/** The most characters a name has: room for "Frederikke" and "Mohammad Ali", short enough to sit above a character. */
export const MAX_NAME_LENGTH = 16;

/** Why a name was refused. */
export type NameRejection =
	/** Nothing was typed (or only spaces), or it is not text at all. */
	| 'empty'
	/** One character: a name has at least `MIN_NAME_LENGTH`. */
	| 'short'
	/** More than `MAX_NAME_LENGTH` characters. */
	| 'long'
	/** Something that is not a letter, a digit, or a single space or hyphen between them. */
	| 'chars'
	/** It holds a rude word. */
	| 'rude';

export type NameCheck = { ok: true; name: string } | { ok: false; reason: NameRejection };

/**
 * Whether `raw` is a name, and the name it is: trimmed, its inner spaces
 * single, in NFC. The name that comes back passes again unchanged.
 */
export function checkName(raw: unknown): NameCheck {
	if (typeof raw !== 'string') return { ok: false, reason: 'empty' };
	const name = tidy(raw);
	if (name === '') return { ok: false, reason: 'empty' };
	if (!wordsOnly(name)) return { ok: false, reason: 'chars' };
	const length = Array.from(name).length;
	if (length < MIN_NAME_LENGTH) return { ok: false, reason: 'short' };
	if (length > MAX_NAME_LENGTH) return { ok: false, reason: 'long' };
	if (isRude(name)) return { ok: false, reason: 'rude' };
	return { ok: true, name };
}

/**
 * The key two names are the same by, whatever their case: "Nini", "NINI" and
 * "nini" share one, and so do letters that are one letter in another form
 * (full-width "Ｎｉｎｉ", "ß" and "ss"). One account per key.
 */
export function nameKey(name: string): string {
	return tidy(name).normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC');
}

/** The typed text as a name is kept: NFC, white space made single spaces, trimmed. */
function tidy(raw: string): string {
	return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

const LETTER = /^\p{L}$/u;
const DIGIT = /^\p{Nd}$/u;
const MARK = /^[\p{Mn}\p{Mc}]$/u;
/** Characters that draw as nothing, even those Unicode calls letters (the Hangul fillers). */
const INVISIBLE = /^\p{Default_Ignorable_Code_Point}$/u;

/**
 * Whether a tidy name is only letters (each with the marks that belong on it,
 * at most `MAX_MARKS_PER_LETTER`) and digits, in words joined by one space or
 * one hyphen.
 */
function wordsOnly(name: string): boolean {
	let afterWord = false;
	let letter = '';
	let marks = 0;
	for (const c of name) {
		if (INVISIBLE.test(c)) return false;
		if (LETTER.test(c) || DIGIT.test(c)) {
			afterWord = true;
			letter = LETTER.test(c) ? c : '';
			marks = 0;
		} else if (MARK.test(c)) {
			if (!letter || ++marks > MAX_MARKS_PER_LETTER || !belongsOn(c, letter)) return false;
		} else if (c === ' ' || c === '-') {
			if (!afterWord) return false;
			afterWord = false;
			letter = '';
		} else {
			return false;
		}
	}
	return afterWord;
}

/**
 * Rude wherever they stand: inside a longer word, and across the spaces and
 * hyphens of a name ("Fu Ck"). Only words no real name holds: "cunt" is in
 * Scunthorpe, "penis" in Penistone, "shit" in Yoshito, "anus" in Janus, "ass"
 * in Hassan, "pik" in Pikachu, so those count only as a word of their own
 * (`RUDE_WORDS`).
 */
const RUDE_ANYWHERE = [
	'arsehole',
	'asshole',
	'bastard',
	'bitch',
	'bollocks',
	'cocksucker',
	'dildo',
	'faggot',
	'fuck',
	'hitler',
	'nigga',
	'nigger',
	'pussy',
	'vagina',
	'whore',
	// Danish
	'bøsserøv',
	'fisse',
	'horeunge',
	'kneppe',
	'kusse',
	'kælling',
	'lorte',
	'perker',
	'pikfjæs',
	'pikhoved',
	'røvhul',
	'spasser',
	'tissemand'
];

/** Rude as a word of their own: a whole word of the name, never a part of one. */
const RUDE_WORDS = [
	'anal',
	'anus',
	'arse',
	'ass',
	'asses',
	'boob',
	'boobs',
	'cock',
	'cocks',
	'cum',
	'cunt',
	'cunts',
	'dick',
	'dicks',
	'fag',
	'fags',
	'horny',
	'nazi',
	'nazis',
	'penis',
	'piss',
	'porn',
	'porno',
	'prick',
	'rape',
	'retard',
	'sex',
	'sexy',
	'shit',
	'shits',
	'shitty',
	'slut',
	'sluts',
	'tit',
	'tits',
	'twat',
	'wank',
	'wanker',
	// Danish
	'bøsse',
	'fanden',
	'helvede',
	'hore',
	'idiot',
	'lort',
	'luder',
	'mongol',
	'neger',
	'pik',
	'pikke',
	'pikken',
	'pis',
	'røv',
	'røven',
	'satan'
];

/** Digits read as the letters they stand in for ("sh1t", "5ex"). */
const LEET: Readonly<Record<string, string>> = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't' };

/** A name as the rude words are looked for in it: accents off, lower case, digits read as letters. */
function fold(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[013457]/g, (d) => LEET[d]!);
}

/** Each run of one letter made one ("fuuuck" → "fuck"). */
function squeeze(text: string): string {
	return text.replace(/(.)\1+/gu, '$1');
}

/**
 * A rude word as it is looked for. A word with no letter twice in a row is
 * also found drawn out ("shiiit"); one with a double letter is found only as
 * it is spelt, since squeezing it would find it in innocent names ("ass" in
 * "As").
 */
interface Rude {
	text: string;
	drawnOut: boolean;
}

function rude(words: readonly string[]): Rude[] {
	return words.map((word) => {
		const text = fold(word);
		return { text, drawnOut: squeeze(text) === text };
	});
}

const ANYWHERE = rude(RUDE_ANYWHERE);
const WHOLE = rude(RUDE_WORDS);

function isRude(name: string): boolean {
	const words = fold(name).split(/[ -]/);
	const joined = words.join('');
	const squeezedJoined = squeeze(joined);
	for (const { text, drawnOut } of ANYWHERE) {
		if (joined.includes(text) || (drawnOut && squeezedJoined.includes(text))) return true;
	}
	for (const word of words) {
		const squeezed = squeeze(word);
		if (WHOLE.some(({ text, drawnOut }) => word === text || (drawnOut && squeezed === text))) {
			return true;
		}
	}
	return false;
}
