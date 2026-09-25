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
	for (const c of name) {
		if (!/[\p{L}\p{Nd} '.-]/u.test(c) || /\p{Default_Ignorable_Code_Point}/u.test(c)) {
			found.push(`holds U+${c.codePointAt(0)!.toString(16).toUpperCase()}`);
		}
	}
	return found;
}

describe('normalizeNickname', () => {
	it('returns a clean name or no name, for any text at all', () => {
		let named = 0;
		for (const raw of fuzzed) {
			const name = normalizeNickname(raw);
			if (name === undefined) continue;
			named++;
			expect({ raw, name, problems: problems(name) }).toEqual({ raw, name, problems: [] });
		}
		// The fuzzer must reach both sides, or the sweep proves little.
		expect(named).toBeGreaterThan(FUZZ / 3);
		expect(named).toBeLessThan(FUZZ);
	});

	it('is idempotent', () => {
		for (const raw of fuzzed) {
			const once = normalizeNickname(raw);
			if (once !== undefined) expect(normalizeNickname(once)).toBe(once);
		}
	});

	it('keeps a name a kid typed exactly as typed', () => {
		for (let i = 0; i < 2000; i++) {
			const name = plainName(new Rng(hashInts(0xa11ce, i)));
			expect(normalizeNickname(name)).toBe(name);
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
	});

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
	});
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
