/**
 * A nickname holds at most this many characters: Unicode code points, so an
 * accent that no single letter carries (a Hindi vowel sign, a Hebrew point)
 * counts as one. Long enough for "Mr Whiskers", short enough for a party card
 * and a battle status box.
 */
export const MAX_NICKNAME_LENGTH = 12;

/**
 * How many accent marks one letter may carry. Real names need up to four
 * (Burmese "ကျော်", Hebrew "שָּׂ" with its vowel, dagesh and sin dot); more is
 * a tower of marks, not a name.
 */
const MAX_MARKS_PER_LETTER = 4;
/** Raw input past this many UTF-16 units is never looked at: the name is cut far shorter anyway. */
const MAX_RAW_LENGTH = 1000;
/** Cleaning settles after a pass or two and is confirmed by the next; this only bounds a surprise. */
const MAX_PASSES = 6;

/** Apostrophe look-alikes a keyboard or tablet types ("Pip’s" → "Pip's"). */
const APOSTROPHES = /[\u0060\u00B4\u02BC\u2018\u2019\u201B\u2032]/gu;
/** Dashes and minus signs. */
const DASHES = /[\u2010-\u2015\u2212]/gu;
/**
 * Everything a name may not hold: anything but a letter, a (non-enclosing)
 * mark, a digit, a space, a hyphen, an apostrophe or a dot. Default-ignorable
 * characters go too, even the ones Unicode calls letters or marks (the Hangul
 * fillers, variation selectors), because they draw as nothing and would make
 * a name that looks empty. Which of the marks stay is `belongsOn`'s call.
 */
const NOT_ALLOWED = /[^\p{L}\p{Mn}\p{Mc}\p{Nd} '.-]|\p{Default_Ignorable_Code_Point}/gu;
const LETTER = /\p{L}/u;
const MARK = /\p{M}/u;
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{Nd}]/u;
/**
 * The generic accents Latin, Greek and Cyrillic names use on letters Unicode
 * has no single character for ("n̈"): grave, acute, circumflex, tilde, macron,
 * breve, dot above, diaeresis, hook above, ring above, double acute, caron,
 * dot below, cedilla, ogonek.
 */
const LATIN_ACCENT = /[\u0300-\u0304\u0306-\u030C\u0323\u0327\u0328]/u;
const LATIN_GREEK_CYRILLIC = /[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u;
/**
 * The scripts whose own marks a name keeps, on letters of the same script.
 * Latin, Greek and Cyrillic are not among them: their letters take only the
 * accents above, because Unicode counts some decorations as Latin too (the
 * overline, the medieval superscript letters).
 */
const SCRIPTS_WITH_MARKS = [
	'Arabic',
	'Armenian',
	'Balinese',
	'Bengali',
	'Devanagari',
	'Ethiopic',
	'Georgian',
	'Gujarati',
	'Gurmukhi',
	'Hangul',
	'Hebrew',
	'Hiragana',
	'Javanese',
	'Kannada',
	'Katakana',
	'Khmer',
	'Lao',
	'Malayalam',
	'Mongolian',
	'Myanmar',
	'Oriya',
	'Sinhala',
	'Sundanese',
	'Syriac',
	'Tamil',
	'Telugu',
	'Thaana',
	'Thai',
	'Tibetan'
].map((script) => new RegExp(`\\p{Script_Extensions=${script}}`, 'u'));

/**
 * Whether a mark spells the name on this letter: it belongs to the letter's
 * own script (a Hindi vowel sign on a Hindi letter, a Hebrew point, Thai and
 * Burmese vowels, Arabic vowel marks), or, on a Latin, Greek or Cyrillic
 * letter, it is one of the accents above. Every other mark decorates rather
 * than spells — underlines, strike-throughs, arrows and boxes under or over a
 * letter, a script's mark stuck on another script's letter, the marks text
 * generators stack — and goes, like any other symbol.
 */
function belongsOn(mark: string, letter: string): boolean {
	if (LATIN_GREEK_CYRILLIC.test(letter)) return LATIN_ACCENT.test(mark);
	return SCRIPTS_WITH_MARKS.some((script) => script.test(mark) && script.test(letter));
}

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
 *   and up to four marks on each letter they belong on (`belongsOn`: "राम", "שָׁלוֹם"):
 *   emoji, symbols, marks that decorate rather than spell, control and
 *   invisible characters are dropped, and so is a mark with no letter under it.
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
	// A mark stays only on a letter it belongs on, and only the first few on each.
	let kept = '';
	let letter = ''; // the letter the next marks sit on; '' after anything else
	let marks = 0;
	for (const c of allowed) {
		if (MARK.test(c)) {
			if (!letter || marks >= MAX_MARKS_PER_LETTER || !belongsOn(c, letter)) continue;
			marks++;
		} else {
			letter = LETTER.test(c) ? c : '';
			marks = 0;
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
