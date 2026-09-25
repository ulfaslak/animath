/**
 * A nickname holds at most this many characters: Unicode code points, so an
 * accent that no single letter carries (a Hindi vowel sign, a Hebrew point)
 * counts as one. Long enough for "Mr Whiskers", short enough for a party card
 * and a battle status box.
 */
export const MAX_NICKNAME_LENGTH = 12;

/** How many accent marks one letter may carry: enough for any alphabet, too few to stack a tower. */
const MAX_MARKS_PER_LETTER = 2;
/** Raw input past this many UTF-16 units is never looked at: the name is cut far shorter anyway. */
const MAX_RAW_LENGTH = 1000;
/** Cleaning settles after a pass or two and is confirmed by the next; this only bounds a surprise. */
const MAX_PASSES = 6;

/** Apostrophe look-alikes a keyboard or tablet types ("Pip’s" → "Pip's"). */
const APOSTROPHES = /[\u0060\u00B4\u02BC\u2018\u2019\u201B\u2032]/gu;
/** Dashes and minus signs. */
const DASHES = /[\u2010-\u2015\u2212]/gu;
/**
 * Everything a name may not hold: anything but a letter, an accent mark, a
 * digit, a space, a hyphen, an apostrophe or a dot. Default-ignorable
 * characters go too, even the ones Unicode calls letters or marks (the Hangul
 * fillers, variation selectors), because they draw as nothing and would make
 * a name that looks empty.
 */
const NOT_ALLOWED = /[^\p{L}\p{M}\p{Nd} '.-]|\p{Default_Ignorable_Code_Point}/gu;
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;

/**
 * Cleans a typed nickname, or returns undefined when nothing usable is left:
 * no nickname, and the client shows the species' name. The rules, in order:
 *
 * - NFKC, so fancy and full-width letters become plain ones ("𝓟𝓲𝓹" → "Pip")
 *   and an accent typed as a separate mark joins its letter where Unicode has
 *   one letter for both ("é").
 * - Apostrophe and dash look-alikes become `'` and `-`; any run of white
 *   space becomes one space.
 * - Only letters (any alphabet), digits, spaces, `-`, `'` and `.` are kept,
 *   and accent marks on a letter, at most two per letter ("राम", "שָׁלוֹם"):
 *   emoji, symbols, control and invisible characters are dropped, and so is
 *   a mark with no letter under it.
 * - Spaces are trimmed from both ends, and the name is cut to
 *   `MAX_NICKNAME_LENGTH` code points (then trimmed again), never between a
 *   letter and its marks.
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

/** A character with the marks on it. After the mark rule below, every mark follows a letter. */
const CLUSTER = /\P{M}\p{M}*/gu;

function cleanOnce(text: string): string {
	const allowed = text
		.replace(APOSTROPHES, "'")
		.replace(DASHES, '-')
		.normalize('NFKC')
		.replace(/\s/gu, ' ')
		.replace(NOT_ALLOWED, '');
	// A mark stays only on a letter, and only the first few on each.
	let kept = '';
	let marks = MAX_MARKS_PER_LETTER; // before any letter, nothing can carry a mark
	for (const c of allowed) {
		if (MARK.test(c)) {
			if (marks >= MAX_MARKS_PER_LETTER) continue;
			marks++;
		} else {
			marks = LETTER.test(c) ? 0 : MAX_MARKS_PER_LETTER;
		}
		kept += c;
	}
	// Cut to the cap a whole letter-with-its-marks at a time.
	let cut = '';
	let length = 0;
	for (const cluster of kept.replace(/ {2,}/g, ' ').trim().match(CLUSTER) ?? []) {
		length += Array.from(cluster).length;
		if (length > MAX_NICKNAME_LENGTH) break;
		cut += cluster;
	}
	return cut.trim();
}
