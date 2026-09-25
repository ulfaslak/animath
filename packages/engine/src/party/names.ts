/**
 * A nickname holds at most this many characters (Unicode code points, which
 * after cleaning are the letters a kid sees). Long enough for "Mr Whiskers",
 * short enough for a party card and a battle status box.
 */
export const MAX_NICKNAME_LENGTH = 12;

/** Raw input past this many UTF-16 units is never looked at: the name is cut far shorter anyway. */
const MAX_RAW_LENGTH = 1000;
/** Cleaning settles after one pass or two and is confirmed by the next; this only bounds a surprise. */
const MAX_PASSES = 6;

/** Apostrophe look-alikes a keyboard or tablet types ("Pip’s" → "Pip's"). */
const APOSTROPHES = /[\u0060\u00B4\u02BC\u2018\u2019\u201B\u2032]/gu;
/** Dashes and minus signs. */
const DASHES = /[\u2010-\u2015\u2212]/gu;
/**
 * Everything a name may not hold: anything but a letter, a digit, a space,
 * a hyphen, an apostrophe or a dot. Default-ignorable characters go too, even
 * the ones Unicode calls letters (the Hangul fillers), because they draw as
 * nothing and would make a name that looks empty.
 */
const NOT_ALLOWED = /[^\p{L}\p{Nd} '.-]|\p{Default_Ignorable_Code_Point}/gu;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

/**
 * Cleans a typed nickname, or returns undefined when nothing usable is left:
 * no nickname, and the client shows the species' name. The rules, in order:
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
 * because one pass is not enough (for about 1 random string in 400): dropping
 * a character can put two Hangul jamo side by side, which NFKC then joins, and
 * NFKC can make an apostrophe look-alike out of a letter ("ŉ" becomes "ʼn").
 */
export function normalizeNickname(raw: unknown): string | undefined {
	if (typeof raw !== 'string') return undefined;
	let name = raw.slice(0, MAX_RAW_LENGTH);
	for (let pass = 0; ; pass++) {
		const next = cleanOnce(name);
		if (next === name) break;
		if (pass === MAX_PASSES) return undefined;
		name = next;
	}
	return HAS_LETTER_OR_DIGIT.test(name) ? name : undefined;
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
