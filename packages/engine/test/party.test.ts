import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import { MAX_PARTY, type AnimalInstance } from '../src/animals/types.js';
import { startBattle } from '../src/battle/reducer.js';
import { MAX_NICKNAME_LENGTH, normalizeNickname } from '../src/party/names.js';
import { applyPartyIntent, leadIndex } from '../src/party/reducer.js';
import type { PartyIntent, PartyRejection, PartyStep, PlayerActivity } from '../src/party/types.js';
import { Rng, hashInts } from '../src/rng.js';

/**
 * Party management: the nickname cleaner, reorder and rename. The cleaner is
 * fuzzed with strings built from the parts of Unicode that break naive name
 * handling (combining marks, compatibility letters that expand under NFKC,
 * Hangul jamo that compose, invisible "letters", emoji sequences, lone
 * surrogates, every kind of space); the reducer is swept over random parties.
 */

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

const chars = (s: string) => Array.from(s).length;

// --- a fuzzer for typed names ------------------------------------------------

/** Code point ranges, each as likely as the next, so rare scripts get drawn. */
const RANGES: readonly (readonly [number, number])[] = [
	[0x20, 0x7e], // ASCII
	[0x20, 0x7e],
	[0x00, 0x1f], // control
	[0xa0, 0xff], // Latin-1: NBSP, acute accent, æ ø å, ß
	[0x100, 0x24f], // Latin extended: ŉ, Ǆ ǅ ǆ
	[0x2b0, 0x2ff], // modifier letters
	[0x300, 0x36f], // combining marks
	[0x370, 0x3ff], // Greek, with U+037A (a letter that NFKC turns into a space and a mark)
	[0x400, 0x4ff], // Cyrillic
	[0x591, 0x5f4], // Hebrew points and letters
	[0x600, 0x6ff], // Arabic
	[0xe00, 0xe7f], // Thai, with U+0E33 (a letter that NFKC splits into a mark and a letter)
	[0x1100, 0x11ff], // Hangul jamo, with the invisible fillers
	[0x1e00, 0x1eff], // Latin extended additional
	[0x2000, 0x206f], // spaces, zero-width joiners, dashes, quotes, bidi controls
	[0x2100, 0x214f], // letterlike symbols: ohm, angstrom
	[0x2460, 0x24ff], // circled numbers and letters
	[0x3000, 0x303f], // CJK punctuation, ideographic space
	[0x3130, 0x318f], // Hangul compatibility jamo, with the Hangul filler
	[0x4e00, 0x4e3f], // CJK ideographs
	[0xac00, 0xac3f], // Hangul syllables
	[0xd800, 0xdfff], // lone surrogates
	[0xfb00, 0xfb06], // ligatures: ﬁ ﬂ
	[0xfdf0, 0xfdfd], // Arabic ligatures that expand to whole phrases
	[0xfe00, 0xfe0f], // variation selectors
	[0xff00, 0xffef], // full-width forms, with the half-width Hangul filler
	[0x1d400, 0x1d7ff], // mathematical letters
	[0x1f300, 0x1faff], // emoji, skin tones
	[0xe0000, 0xe007f] // tags
];

function randomText(rng: Rng): string {
	const length = rng.int(0, 40);
	let text = '';
	for (let i = 0; i < length; i++) {
		const [lo, hi] = rng.pick(RANGES);
		text += String.fromCodePoint(rng.int(lo, hi));
	}
	return text;
}

/** Strings a kid actually types: letters, digits, single spaces inside. */
function plainName(rng: Rng): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZæøåÆØÅéü0123456789';
	const length = rng.int(1, MAX_NICKNAME_LENGTH);
	let name = '';
	for (let i = 0; i < length; i++) {
		const space = i > 0 && i < length - 1 && name.at(-1) !== ' ' && rng.next() < 0.15;
		name += space ? ' ' : alphabet[rng.int(0, alphabet.length - 1)];
	}
	return name;
}

const FUZZ = 6000;
const fuzzed = Array.from({ length: FUZZ }, (_, i) => randomText(new Rng(hashInts(0x5eed, i))));

/**
 * Whether a mark belongs on the letter under it: the test's own statement of
 * the rule, over more scripts than the cleaner lists. Latin, Greek and
 * Cyrillic letters take only the listed accents.
 */
const TEST_SCRIPTS = [
	'Arabic',
	'Armenian',
	'Balinese',
	'Bengali',
	'Buginese',
	'Cham',
	'Cyrillic',
	'Devanagari',
	'Ethiopic',
	'Georgian',
	'Greek',
	'Gujarati',
	'Gurmukhi',
	'Hangul',
	'Hebrew',
	'Hiragana',
	'Javanese',
	'Kannada',
	'Katakana',
	'Kharoshthi',
	'Khmer',
	'Lao',
	'Latin',
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
	'Tibetan',
	'Vai'
].map((script) => new RegExp(`\\p{Script_Extensions=${script}}`, 'u'));
const GENERIC_LATIN_ACCENT = /[\u0300-\u0304\u0306-\u030C\u0323\u0327\u0328]/u;
function sharesScript(mark: string, letter: string): boolean {
	if (/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/u.test(letter)) {
		return GENERIC_LATIN_ACCENT.test(mark);
	}
	if (/\p{Script=Inherited}/u.test(mark)) {
		const arabicVowel = /[\u064B-\u065F\u0670]/u.test(mark);
		const kanaVoicing = /[\u3099\u309A]/u.test(mark);
		return (
			(arabicVowel && /\p{Script_Extensions=Arabic}/u.test(letter)) ||
			(kanaVoicing && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(letter))
		);
	}
	return TEST_SCRIPTS.some((script) => script.test(mark) && script.test(letter));
}

/** Every promise a cleaned name makes, as the list of the ones it breaks. */
function problems(name: string): string[] {
	const found: string[] = [];
	if (normalizeNickname(name) !== name) found.push('cleaning it again changes it');
	if (chars(name) < 1) found.push('empty');
	if (chars(name) > MAX_NICKNAME_LENGTH) found.push('too long');
	if (name !== name.trim()) found.push('space at an end');
	if (name.includes('  ')) found.push('two spaces in a row');
	if (name !== name.normalize('NFKC')) found.push('not NFKC');
	if (!/[\p{L}\p{Nd}]/u.test(name)) found.push('no letter or digit');
	let letter = ''; // the letter the next marks sit on
	let marks = 0;
	for (const c of name) {
		const code = `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`;
		if (/\p{Default_Ignorable_Code_Point}/u.test(c)) found.push(`holds ${code}`);
		if (/\p{M}/u.test(c)) {
			if (!letter || marks >= 4) found.push(`a mark on no letter, or a fifth on one: ${code}`);
			else if (!sharesScript(c, letter))
				found.push(`a mark that does not belong on ${letter}: ${code}`);
			marks++;
			continue;
		}
		letter = /\p{L}/u.test(c) ? c : '';
		marks = 0;
		if (!/[\p{L}\p{Nd} '.-]/u.test(c)) found.push(`holds ${code}`);
	}
	return found;
}

/** Names in alphabets that put marks on letters, as a kid would type them. */
const SYLLABLES = [
	'र\u093E', // रा
	'म\u093F', // मि
	'क\u0941', // कु
	'स\u094D', // स् (a virama)
	'ש\u05B8\u05C1', // שָׁ
	'ל',
	'ו\u05B9', // וֹ
	'n\u0308', // n̈: no single letter for it
	'ø',
	'ก\u0E34', // กิ
	'ñ',
	'ж'
];

function markedName(rng: Rng): string {
	let name = '';
	while (true) {
		const next = name + rng.pick(SYLLABLES);
		if (Array.from(next).length > MAX_NICKNAME_LENGTH) return name;
		name = next;
		if (rng.next() < 0.2) return name;
	}
}

describe('normalizeNickname', () => {
	it('returns a clean name or no name, for any text at all', () => {
		let named = 0;
		// Collected and asserted once: an `expect` per string cost more than the cleaner.
		const dirty: { raw: string; name: string; problems: string[] }[] = [];
		for (const raw of fuzzed) {
			const name = normalizeNickname(raw);
			if (name === undefined) continue;
			named++;
			const found = problems(name);
			if (found.length > 0) dirty.push({ raw, name, problems: found });
		}
		expect(dirty).toEqual([]);
		// The fuzzer must reach both sides, or the sweep proves little.
		expect(named).toBeGreaterThan(FUZZ / 3);
		expect(named).toBeLessThan(FUZZ);
		// Up to 2 s alone (6,000 hostile strings, cleaned until a pass changes nothing);
		// over vitest's 5 s default when other agents' browsers load the machine.
	}, 30_000);

	it('is idempotent', () => {
		const moved: { raw: string; once: string; twice: string | undefined }[] = [];
		for (const raw of fuzzed) {
			const once = normalizeNickname(raw);
			if (once === undefined) continue;
			const twice = normalizeNickname(once);
			if (twice !== once) moved.push({ raw, once, twice });
		}
		expect(moved).toEqual([]);
		// About 1 s alone (12,000 cleanings); over 5 s under a heavy load.
	}, 30_000);

	it('keeps a name a kid typed exactly as typed', () => {
		for (let i = 0; i < 2000; i++) {
			const name = plainName(new Rng(hashInts(0xa11ce, i)));
			expect(normalizeNickname(name)).toBe(name);
		}
	});

	it('drops every mark that decorates a letter rather than spells it', () => {
		// Named, not derived from the rule: underline and overline, the strike-through
		// overlays, arrows and an x below, enclosing circles and a keycap, Vedic and
		// half marks, the deletion mark. Text generators stack these on letters.
		const decorations = [
			0x0305, 0x0332, 0x0333, 0x0334, 0x0335, 0x0336, 0x0337, 0x0338, 0x0353, 0x0354, 0x0355,
			0x0356, 0x0362, 0x0489, 0x1cd4, 0x1ce2, 0x1dfb, 0x20d0, 0x20d2, 0x20dd, 0x20e0, 0x20e3,
			0x20f0, 0xfe20, 0xfe2f
		];
		// On letters of seven scripts: Unicode ties some decorations to a script
		// (the overline to kana), and a decoration is one on every letter.
		const letters = [0x0050, 0x0436, 0x0915, 0x30ab, 0x0628, 0x05e9, 0x0e01];
		for (const cp of decorations) {
			for (const letter of letters) {
				const l = String.fromCodePoint(letter);
				const raw = `${l}${String.fromCodePoint(cp)}${l}`;
				expect({ cp: cp.toString(16), name: normalizeNickname(raw) }).toEqual({
					cp: cp.toString(16),
					name: l + l
				});
			}
		}
	});

	it('keeps the accent marks an alphabet puts on its letters', () => {
		for (let i = 0; i < 2000; i++) {
			const name = markedName(new Rng(hashInts(0xacce, i))).normalize('NFKC');
			if (name === '') continue;
			expect({ name, clean: normalizeNickname(name) }).toEqual({ name, clean: name });
		}
	});

	it('cleans the things kids and keyboards actually do', () => {
		const cases: [unknown, string | undefined][] = [
			['  Pip  ', 'Pip'],
			['Mr   Fluff', 'Mr Fluff'],
			['Mr\tFluff\n', 'Mr Fluff'],
			['Søren', 'Søren'],
			['Æble', 'Æble'],
			['e\u0301clair', '\u00E9clair'],
			['\u{1D4DF}\u{1D4F2}\u{1D4F9}', 'Pip'], // mathematical script letters
			['\uFF30\uFF29\uFF30', 'PIP'], // full-width letters
			['Pip\u{1F600}', 'Pip'],
			['\u{1F600}\u{1F43F}\uFE0F', undefined],
			['\u{1F468}\u200D\u{1F469}\u200D\u{1F467}', undefined], // a family emoji
			['Pip\u2019s', "Pip's"],
			['Ann\u2013Marie', 'Ann-Marie'],
			['R2-D2', 'R2-D2'],
			['Pip\u200BPop', 'PipPop'], // zero-width space
			['\u3164', undefined], // Hangul filler: a "letter" that draws as nothing
			['\u3164Pip', 'Pip'],
			['\u115F\u1160', undefined],
			['\u0301\u0301', undefined],
			['\u1100\u{1F600}\u1161', '\uAC00'], // jamo that meet once the emoji goes
			['र\u093Eम', 'र\u093Eम'], // राम: the vowel sign stays on its letter
			['ש\u05B8\u05C1ל\u05D5\u05B9ם', 'ש\u05B8\u05C1ל\u05D5\u05B9ם'], // שָׁלוֹם
			['n\u0308', 'n\u0308'], // no single letter for n with two dots: the mark stays
			['x\u0301\u0302\u0303\u0304\u0306', 'x\u0301\u0302\u0303\u0304'], // four marks a letter, not a tower
			['\u1000\u103B\u1031\u102C\u103A', '\u1000\u103B\u1031\u102C\u103A'], // Burmese Kyaw: four marks on one letter
			[
				'\u05D9\u05B4\u05E9\u05B8\u05BC\u05C2\u05E9\u05DB\u05B8\u05E8',
				'\u05D9\u05B4\u05E9\u05B8\u05BC\u05C2\u05E9\u05DB\u05B8\u05E8'
			], // Issachar: vowel, dagesh and sin dot
			['\u091C\u093C\u093F\u0902\u0926\u093E', '\u091C\u093C\u093F\u0902\u0926\u093E'], // Hindi zinda: nukta, vowel sign, anusvara
			['\u1789\u17C9\u17B6\u17C6', '\u1789\u17C9\u17B6\u17C6'], // Khmer
			['Pip\u20E0', 'Pip'], // an enclosing "no" sign over the p is a symbol
			['P\u0336i\u0336p\u0336', 'Pip'], // strike-through
			['x\u0489', 'x'], // an enclosing Cyrillic sign
			[
				'\u0645\u064F\u062D\u064E\u0645\u064E\u0651\u062F',
				'\u0645\u064F\u062D\u064E\u0645\u064E\u0651\u062F'
			], // Arabic vowel marks stay on Arabic letters
			['\u0416\u0483', '\u0416'], // Latin, Greek and Cyrillic letters take only the listed accents
			['\u304B\u3099', '\u304C'], // a voicing mark joins its kana
			['n\u0305', 'n'], // an overline, which Unicode also counts as Latin
			['\u0915\u05B8', '\u0915'], // a Hebrew vowel on a Hindi letter
			['\u0301abc', 'abc'], // a mark on nothing
			['1\u0301 2', '1 2'], // a mark on a digit
			['a'.repeat(11) + 'x\u0301', 'a'.repeat(11)], // never cut between a letter and its mark
			['', undefined],
			['     ', undefined],
			['---', undefined],
			['. . .', undefined],
			['Sir Fluffington the Third', 'Sir Fluffing'],
			['abcdefghijk lmn', 'abcdefghijk'],
			['Pip'.repeat(400), 'PipPipPipPip'],
			[7, undefined],
			[undefined, undefined],
			[null, undefined]
		];
		for (const [raw, expected] of cases) {
			expect({ raw, name: normalizeNickname(raw) }).toEqual({ raw, name: expected });
		}
	});
});

// --- the reducer -------------------------------------------------------------

function randomParty(rng: Rng, size = rng.int(1, MAX_PARTY)): AnimalInstance[] {
	return Array.from({ length: size }, (_, i) => {
		const spec = rng.pick(ANIMALS);
		const animal: AnimalInstance = {
			id: `${spec.id}-${i}`,
			speciesId: spec.id,
			hp: rng.next() < 0.25 ? 0 : rng.int(1, spec.maxHp)
		};
		const nickname = rng.next() < 0.4 ? normalizeNickname(plainName(rng)) : undefined;
		if (nickname !== undefined) animal.nickname = nickname;
		return animal;
	});
}

const PARTIES = Array.from({ length: 200 }, (_, i) => deepFreeze(randomParty(new Rng(i + 1))));

/** Refused: the very same party back, and one `rejected` event naming the animal when it is in the party. */
function expectRejected(
	party: readonly AnimalInstance[],
	step: PartyStep,
	reason: PartyRejection,
	animalId?: string
): void {
	expect(step.party).toBe(party);
	expect(step.events).toEqual([
		animalId === undefined ? { type: 'rejected', reason } : { type: 'rejected', reason, animalId }
	]);
}

function byId(party: readonly AnimalInstance[]): Map<string, AnimalInstance> {
	return new Map(party.map((a) => [a.id, a]));
}

/** The party's ids with one left out: what must keep its order when that one moves. */
function othersInOrder(party: readonly AnimalInstance[], left: string): string[] {
	return party.map((a) => a.id).filter((id) => id !== left);
}

describe('applyPartyIntent: select-lead', () => {
	it('moves a standing animal to the front, where it leads; refuses a tired one and the lead', () => {
		let chosen = 0;
		for (const party of PARTIES) {
			for (const [from, animal] of party.entries()) {
				const step = applyPartyIntent(
					party,
					{ type: 'select-lead', animalId: animal.id },
					'explore'
				);
				if (animal.hp === 0) {
					expectRejected(party, step, 'tired', animal.id);
					continue;
				}
				if (leadIndex(party) === from) {
					expectRejected(party, step, 'already-lead', animal.id);
					continue;
				}
				chosen++;
				expect(step.events).toEqual([{ type: 'lead-selected', animalId: animal.id, from }]);
				expect(step.party[0]!.id).toBe(animal.id);
				expect(leadIndex(step.party)).toBe(0);
				expect(othersInOrder(step.party, animal.id)).toEqual(othersInOrder(party, animal.id));
				const before = byId(party);
				for (const a of step.party) expect(a).toEqual(before.get(a.id));
			}
		}
		expect(chosen).toBeGreaterThan(100);
	});

	it('the chosen lead is the animal that steps into the next battle', () => {
		const wild: AnimalInstance = { id: 'wild', speciesId: 'rabbit', hp: 22 };
		for (const party of PARTIES) {
			for (const animal of party.filter((a) => a.hp > 0)) {
				const step = applyPartyIntent(
					party,
					{ type: 'select-lead', animalId: animal.id },
					'explore'
				);
				const battle = startBattle(step.party, wild);
				expect(battle.party[battle.active]!.id).toBe(animal.id);
			}
		}
	});

	it('refuses an animal that is not in the party', () => {
		const party = PARTIES[0]!;
		for (const animalId of ['nobody', '', 3, null, undefined]) {
			const intent = { type: 'select-lead', animalId } as unknown as PartyIntent;
			expectRejected(party, applyPartyIntent(party, intent, 'explore'), 'unknown-animal');
		}
	});

	it('out on the water, only an animal that swims goes first, and it is the one that fights there', () => {
		const swims = (a: AnimalInstance) => ANIMALS.find((s) => s.id === a.speciesId)!.realms;
		const wild: AnimalInstance = { id: 'wild', speciesId: 'otter', hp: 32 };
		let chosen = 0;
		let cannot = 0;
		for (const party of PARTIES) {
			for (const [from, animal] of party.entries()) {
				const step = applyPartyIntent(
					party,
					{ type: 'select-lead', animalId: animal.id },
					'explore',
					'water'
				);
				if (!swims(animal).includes('water')) {
					cannot++;
					expectRejected(party, step, 'cannot-fight-here', animal.id);
					continue;
				}
				if (animal.hp === 0) {
					expectRejected(party, step, 'tired', animal.id);
					continue;
				}
				if (leadIndex(party, 'water') === from) {
					expectRejected(party, step, 'already-lead', animal.id);
					continue;
				}
				chosen++;
				expect(step.events).toEqual([{ type: 'lead-selected', animalId: animal.id, from }]);
				expect(leadIndex(step.party, 'water')).toBe(0);
				const battle = startBattle(step.party, wild, { realm: 'water' });
				expect(battle.party[battle.active]!.id).toBe(animal.id);
			}
		}
		expect(chosen).toBeGreaterThan(20);
		expect(cannot).toBeGreaterThan(100);
	});
});

describe('leadIndex', () => {
	it('is the first animal that is standing and can fight where the player stands, or -1', () => {
		for (const party of PARTIES) {
			for (const realm of ['land', 'water'] as const) {
				const expected = party.findIndex(
					(a) => a.hp > 0 && ANIMALS.find((s) => s.id === a.speciesId)!.realms.includes(realm)
				);
				expect(leadIndex(party, realm)).toBe(expected);
			}
			// Land unless said otherwise.
			expect(leadIndex(party)).toBe(leadIndex(party, 'land'));
		}
	});
});


describe('applyPartyIntent: reorder', () => {
	it('moves one animal to the slot asked for and keeps everyone else in order', () => {
		for (const party of PARTIES) {
			for (const [from, animal] of party.entries()) {
				for (let to = 0; to < party.length; to++) {
					const intent: PartyIntent = { type: 'reorder', animalId: animal.id, to };
					const step = applyPartyIntent(party, intent, 'explore');
					if (to === from) {
						expectRejected(party, step, 'already-there', animal.id);
						continue;
					}
					expect(step.events).toEqual([{ type: 'reordered', animalId: animal.id, from, to }]);
					expect(step.party).toHaveLength(party.length);
					expect(step.party[to]!.id).toBe(animal.id);
					expect(othersInOrder(step.party, animal.id)).toEqual(othersInOrder(party, animal.id));
					// Nothing about any animal changes but its place, and no object is shared.
					const before = byId(party);
					for (const moved of step.party) {
						expect(moved).toEqual(before.get(moved.id));
						expect(moved).not.toBe(before.get(moved.id));
					}
				}
			}
		}
		// Up to 2 s alone (every move of every animal in every test party, each checked
		// in full); nearly 4 s with two browsers drawing beside it.
	}, 30_000);

	it('refuses a slot off either end, a slot that is not a whole number, and an unknown animal', () => {
		for (const party of PARTIES.slice(0, 40)) {
			const id = party[0]!.id;
			for (const to of [-1, party.length, party.length + 5, 0.5, NaN, Infinity, '1', null]) {
				const intent = { type: 'reorder', animalId: id, to } as unknown as PartyIntent;
				expectRejected(party, applyPartyIntent(party, intent, 'explore'), 'no-such-slot', id);
			}
			for (const animalId of ['nobody', '', 3, null, undefined]) {
				const intent = { type: 'reorder', animalId, to: 0 } as unknown as PartyIntent;
				expectRejected(party, applyPartyIntent(party, intent, 'explore'), 'unknown-animal');
			}
		}
	});

	it('whoever is first and standing after a move steps into the next battle', () => {
		const wild: AnimalInstance = { id: 'wild', speciesId: 'rabbit', hp: 22 };
		for (const party of PARTIES) {
			for (const animal of party) {
				const intent: PartyIntent = { type: 'reorder', animalId: animal.id, to: 0 };
				const next = applyPartyIntent(party, intent, 'explore').party;
				if (leadIndex(next) < 0) continue;
				const battle = startBattle(next, wild);
				expect(battle.active).toBe(leadIndex(next));
				if (animal.hp > 0) expect(battle.party[battle.active]!.id).toBe(animal.id);
			}
		}
	});
});

describe('applyPartyIntent: rename', () => {
	const typed = [
		'Pip',
		'  Rusty  ',
		'Mr   Fluff',
		'Pip\u{1F600}',
		'\u{1F600}',
		'',
		'   ',
		'Sir Fluffington the Third'
	];

	it('stores the cleaned name, or no nickname at all when nothing usable is left', () => {
		for (const party of PARTIES.slice(0, 60)) {
			for (const animal of party) {
				for (const raw of typed) {
					const intent: PartyIntent = { type: 'rename', animalId: animal.id, nickname: raw };
					const step = applyPartyIntent(party, intent, 'explore');
					const clean = normalizeNickname(raw);
					expect(step.events).toEqual([
						clean === undefined
							? { type: 'renamed', animalId: animal.id }
							: { type: 'renamed', animalId: animal.id, nickname: clean }
					]);
					const renamed = step.party.find((a) => a.id === animal.id)!;
					const rest = { id: animal.id, speciesId: animal.speciesId, hp: animal.hp };
					expect(renamed).toEqual(clean === undefined ? rest : { ...rest, nickname: clean });
					// No nickname is no key, as in a save; never `nickname: undefined`.
					expect(Object.keys(renamed).includes('nickname')).toBe(clean !== undefined);
					expect(Object.keys(step.events[0]!).includes('nickname')).toBe(clean !== undefined);
					// Everyone else, and the order, stay exactly as they were.
					expect(step.party.map((a) => a.id)).toEqual(party.map((a) => a.id));
					for (const other of step.party) {
						if (other.id !== animal.id) expect(other).toEqual(byId(party).get(other.id));
					}
				}
			}
		}
	});

	it('refuses a name that is not text, and an unknown animal', () => {
		const party = PARTIES[0]!;
		for (const nickname of [7, null, undefined, ['Pip'], { name: 'Pip' }]) {
			const id = party[0]!.id;
			const intent = { type: 'rename', animalId: id, nickname } as unknown as PartyIntent;
			expectRejected(party, applyPartyIntent(party, intent, 'explore'), 'not-text', id);
		}
		const intent: PartyIntent = { type: 'rename', animalId: 'nobody', nickname: 'Pip' };
		expectRejected(party, applyPartyIntent(party, intent, 'explore'), 'unknown-animal');
	});
});

describe('applyPartyIntent: when', () => {
	it('changes nothing outside explore, whatever the intent', () => {
		for (const activity of ['battle', 'doctor', 'shopping'] as PlayerActivity[]) {
			for (const party of PARTIES.slice(0, 40)) {
				const animal = party.at(-1)!;
				const intents: PartyIntent[] = [
					{ type: 'select-lead', animalId: animal.id },
					{ type: 'reorder', animalId: animal.id, to: 0 },
					{ type: 'rename', animalId: animal.id, nickname: 'Pip' },
					{ type: 'rename', animalId: animal.id, nickname: '' }
				];
				for (const intent of intents) {
					expectRejected(party, applyPartyIntent(party, intent, activity), 'not-exploring');
				}
			}
		}
	});

	it('refuses anything that is not a party intent', () => {
		const party = PARTIES[0]!;
		for (const intent of [null, undefined, 42, 'reorder', {}, { type: 'fly' }]) {
			const step = applyPartyIntent(party, intent as unknown as PartyIntent, 'explore');
			expectRejected(party, step, 'not-an-intent');
		}
	});

	it('keeps every animal, its HP and a clean name through any run of edits', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const rng = new Rng(hashInts(0xed17, seed));
			let party: readonly AnimalInstance[] = deepFreeze(randomParty(rng));
			const hp = new Map(party.map((a) => [a.id, a.hp]));
			for (let i = 0; i < 30; i++) {
				const animal = rng.pick(party);
				const roll = rng.next();
				const intent: PartyIntent =
					roll < 0.3
						? { type: 'select-lead', animalId: animal.id }
						: roll < 0.65
							? { type: 'reorder', animalId: animal.id, to: rng.int(-1, party.length) }
							: { type: 'rename', animalId: animal.id, nickname: randomText(rng) };
				party = deepFreeze(applyPartyIntent(party, intent, 'explore').party);
				expect(new Map(party.map((a) => [a.id, a.hp]))).toEqual(hp);
				for (const a of party) {
					if (a.nickname !== undefined) expect(problems(a.nickname)).toEqual([]);
				}
			}
		}
		// About 1 s alone (3,000 edits, a third of them cleaning a hostile name); over 1.5 s
		// with two browsers drawing beside it.
	}, 30_000);
});

describe('leadIndex', () => {
	it('is the first animal that is not tired, or -1 when all are', () => {
		const at = (...hp: number[]) =>
			hp.map((h, i) => ({ id: `${i}`, speciesId: 'squirrel', hp: h }));
		expect(leadIndex(at(20, 20))).toBe(0);
		expect(leadIndex(at(0, 5, 20))).toBe(1);
		expect(leadIndex(at(0, 0, 1))).toBe(2);
		expect(leadIndex(at(0, 0))).toBe(-1);
		expect(leadIndex([])).toBe(-1);
	});
});
