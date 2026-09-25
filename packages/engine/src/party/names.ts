import { getAnimal } from '../animals/catalog.js';
import type { AnimalInstance } from '../animals/types.js';

/**
 * A nickname holds at most this many characters (Unicode code points, which
 * after cleaning are the letters a kid sees). Long enough for "Mr Whiskers",
 * short enough for a party card and a battle status box.
 */
export const MAX_NICKNAME_LENGTH = 12;

/** Raw input past this many UTF-16 units is never looked at: the name is cut far shorter anyway. */
const MAX_RAW_LENGTH = 1000;
/** Cleaning settles after one pass and is confirmed by the second; this only bounds a surprise. */
const MAX_PASSES = 6;

/** Apostrophe look-alikes a keyboard or tablet types ("Pip’s" → "Pip's"). */
const APOSTROPHES = /[`´ʼ‘’‛′]/gu;
/** Dashes and minus signs. */
const DASHES = /[‐-―−]/gu;
/**
 * Everything a name may not hold: anything but a letter, a digit, a space,
 * a hyphen, an apostrophe or a dot. Default-ignorable characters go too, even
 * the ones Unicode calls letters (the Hangul fillers), because they draw as
 * nothing and would make a name that looks empty.
 */
const NOT_ALLOWED = /[^\p{L}\p{Nd} '.-]|\p{Default_Ignorable_Code_Point}/gu;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

/**
 * Cleans a typed nickname, or returns null when nothing usable is left (the
 * animal then goes by its species' name). The rules, in order:
 *
 * - NFKC, so fancy and full-width letters become plain ones ("𝓟𝓲𝓹" → "Pip")
 *   and an accent typed as a separate mark joins its letter ("é").
 * - Apostrophe and dash look-alikes become `'` and `-`; any run of white
 *   space becomes one space.
 * - Only letters (any alphabet), digits, spaces, `-`, `'` and `.` are kept:
 *   emoji, symbols, control and invisible characters are dropped, and so are
 *   combining marks left without a letter.
 * - Spaces are trimmed from both ends, and the name is cut to
 *   `MAX_NICKNAME_LENGTH` characters (then trimmed again).
 * - A name with no letter or digit left ("", "   ", "😀", "---") is no name.
 *
 * The result is a fixed point: cleaning a cleaned name returns it unchanged.
 * That holds by construction — the passes repeat until one changes nothing —
 * rather than by an argument about Unicode normalisation that a future
 * Unicode version could break.
 */
export function normalizeNickname(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	let name = raw.slice(0, MAX_RAW_LENGTH);
	for (let pass = 0; ; pass++) {
		const next = cleanOnce(name);
		if (next === name) break;
		if (pass === MAX_PASSES) return null;
		name = next;
	}
	return HAS_LETTER_OR_DIGIT.test(name) ? name : null;
}

function cleanOnce(text: string): string {
	const cleaned = text
		.replace(APOSTROPHES, "'")
		.replace(DASHES, '-')
		.normalize('NFKC')
		.replace(/\s/gu, ' ')
		.replace(NOT_ALLOWED, '')
		.replace(/ {2,}/g, ' ')
		.trim();
	const chars = Array.from(cleaned);
	if (chars.length <= MAX_NICKNAME_LENGTH) return cleaned;
	return chars.slice(0, MAX_NICKNAME_LENGTH).join('').trim();
}

/**
 * What the game calls an animal: its nickname, cleaned, or else its species'
 * name. Cleaning here too means a name from anywhere — an old save, a debug
 * party — reads the same as one typed in the game.
 */
export function animalName(animal: AnimalInstance): string {
	return normalizeNickname(animal.nickname) ?? getAnimal(animal.speciesId).name;
}
