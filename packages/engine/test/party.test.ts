import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import { MAX_PARTY, type AnimalInstance } from '../src/animals/types.js';
import { startBattle } from '../src/battle/reducer.js';
import { MAX_NICKNAME_LENGTH, animalName, normalizeNickname } from '../src/party/names.js';
import { applyPartyIntent, leadIndex } from '../src/party/reducer.js';
import type { PartyIntent, PartyStep, PlayerActivity } from '../src/party/types.js';
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
	[0xa0, 0xff], // Latin-1: NBSP, ´, æ ø å, ß
	[0x100, 0x24f], // Latin extended: ŉ, Ǆ ǅ ǆ
	[0x2b0, 0x2ff], // modifier letters: ʰ ʼ ˆ
	[0x300, 0x36f], // combining marks
	[0x370, 0x3ff], // Greek, with ͺ (a letter that NFKC turns into a space and a mark)
	[0x400, 0x4ff], // Cyrillic
	[0x591, 0x5f4], // Hebrew points and letters
	[0x600, 0x6ff], // Arabic
	[0xe00, 0xe7f], // Thai, with ำ (a letter that NFKC splits into a mark and a letter)
	[0x1100, 0x11ff], // Hangul jamo, with the invisible fillers
	[0x1e00, 0x1eff], // Latin extended additional: ẛ
	[0x2000, 0x206f], // spaces, zero-width joiners, dashes, quotes, bidi controls
	[0x2100, 0x214f], // letterlike symbols: ℌ Ω Å
	[0x2460, 0x24ff], // circled numbers and letters
	[0x3000, 0x303f], // CJK punctuation, ideographic space
	[0x3130, 0x318f], // Hangul compatibility jamo, with ㅤ
	[0x4e00, 0x4e3f], // CJK ideographs
	[0xac00, 0xac3f], // Hangul syllables
	[0xd800, 0xdfff], // lone surrogates
	[0xfb00, 0xfb06], // ligatures: ﬁ ﬂ
	[0xfdf0, 0xfdfd], // Arabic ligatures that expand to whole phrases (ﷺ, ﷽)
	[0xfe00, 0xfe0f], // variation selectors
	[0xff00, 0xffef], // full-width forms, with the half-width Hangul filler
	[0x1d400, 0x1d7ff], // mathematical letters: 𝓟 𝐀
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

/** Every property a cleaned name must have, as one list of broken promises. */
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
	it('returns a clean name or nothing, for any text at all', () => {
		let named = 0;
		for (const raw of fuzzed) {
			const name = normalizeNickname(raw);
			if (name === null) continue;
			named++;
			expect({ raw, name, problems: problems(name) }).toEqual({ raw, name, problems: [] });
		}
		// The fuzzer must reach both sides, or the sweep proves little.
		expect(named).toBeGreaterThan(FUZZ / 3);
		expect(named).toBeLessThan(FUZZ);
	});

	it('is idempotent, including on the raw text of every result', () => {
		for (const raw of fuzzed) {
			const once = normalizeNickname(raw);
			if (once !== null) expect(normalizeNickname(once)).toBe(once);
		}
	});

	it('keeps a name a kid typed exactly as typed', () => {
		for (let i = 0; i < 2000; i++) {
			const name = plainName(new Rng(hashInts(0xa11ce, i)));
			expect(normalizeNickname(name)).toBe(name);
		}
	});

	it('cleans the things kids and keyboards actually do', () => {
		const cases: [unknown, string | null][] = [
			['  Pip  ', 'Pip'],
			['Mr   Fluff', 'Mr Fluff'],
			['Mr\tFluff\n', 'Mr Fluff'],
			['Søren', 'Søren'],
			['Æble', 'Æble'],
			['éclair', 'éclair'],
			['𝓟𝓲𝓹', 'Pip'],
			['ＰＩＰ', 'PIP'],
			['Pip😀', 'Pip'],
			['😀🐿️', null],
			['👨‍👩‍👧', null],
			['Pip’s', "Pip's"],
			['Ann–Marie', 'Ann-Marie'],
			['R2-D2', 'R2-D2'],
			['Pip​Pop', 'PipPop'],
			['ㅤ', null],
			['ㅤPip', 'Pip'],
			['ᅟᅠ', null],
			['́́', null],
			['', null],
			['     ', null],
			['---', null],
			['. . .', null],
			['Sir Fluffington the Third', 'Sir Fluffing'],
			['abcdefghijk lmn', 'abcdefghijk'],
			['Pip'.repeat(400), 'PipPipPipPip'],
			[7, null],
			[undefined, null],
			[null, null]
		];
		for (const [raw, expected] of cases) {
			expect({ raw, name: normalizeNickname(raw) }).toEqual({ raw, name: expected });
		}
	});
});

describe('animalName', () => {
	it('is the nickname when there is one, else the species name', () => {
		expect(animalName({ id: 'a', speciesId: 'fox', hp: 1 })).toBe('Fox');
		expect(animalName({ id: 'a', speciesId: 'fox', nickname: 'Rusty', hp: 1 })).toBe('Rusty');
	});

	it('never shows a name that would not survive cleaning', () => {
		expect(animalName({ id: 'a', speciesId: 'fox', nickname: '', hp: 1 })).toBe('Fox');
		expect(animalName({ id: 'a', speciesId: 'fox', nickname: '  Rusty ', hp: 1 })).toBe('Rusty');
		expect(animalName({ id: 'a', speciesId: 'otter', nickname: '😀', hp: 1 })).toBe('Otter');
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
		if (rng.next() < 0.4) animal.nickname = normalizeNickname(plainName(rng)) ?? undefined;
		if (animal.nickname === undefined) delete animal.nickname;
		return animal;
	});
}

const PARTIES = Array.from({ length: 200 }, (_, i) => deepFreeze(randomParty(new Rng(i + 1))));

function expectRejected(party: readonly AnimalInstance[], step: PartyStep): void {
	expect(step.party).toBe(party);
	expect(step.events).toHaveLength(1);
	expect(step.events[0]!.type).toBe('rejected');
}

function byId(party: readonly AnimalInstance[]): Map<string, AnimalInstance> {
	return new Map(party.map((a) => [a.id, a]));
}

describe('applyPartyIntent: reorder', () => {
	it('moves one animal to the slot asked for and keeps everyone else in order', () => {
		for (const party of PARTIES) {
			for (const [from, animal] of party.entries()) {
				for (let to = 0; to < party.length; to++) {
					const intent: PartyIntent = { type: 'reorder', animalId: animal.id, to };
					const step = applyPartyIntent(party, intent, 'explore');
					if (to === from) {
						expectRejected(party, step);
						continue;
					}
					expect(step.events).toEqual([{ type: 'reordered', animalId: animal.id, from, to }]);
					expect(step.party).toHaveLength(party.length);
					expect(step.party[to]!.id).toBe(animal.id);
					const others = (p: readonly AnimalInstance[]) =>
						p.map((a) => a.id).filter((id) => id !== animal.id);
					expect(others(step.party)).toEqual(others(party));
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
				expectRejected(party, applyPartyIntent(party, intent, 'explore'));
			}
			for (const animalId of ['nobody', '', 3, null, undefined]) {
				const intent = { type: 'reorder', animalId, to: 0 } as unknown as PartyIntent;
				expectRejected(party, applyPartyIntent(party, intent, 'explore'));
			}
		}
	});

	it('the new lead is the one that steps into the next battle', () => {
		const wild: AnimalInstance = { id: 'wild', speciesId: 'rabbit', hp: 22 };
		for (const party of PARTIES) {
			for (const animal of party) {
				const step = applyPartyIntent(
					party,
					{ type: 'reorder', animalId: animal.id, to: 0 },
					'explore'
				);
				const next = step.party;
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
		'Pip😀',
		'😀',
		'',
		'   ',
		'Sir Fluffington the Third'
	];

	it('stores the cleaned name, or clears it when nothing usable is left', () => {
		for (const party of PARTIES.slice(0, 60)) {
			for (const animal of party) {
				for (const raw of typed) {
					const intent: PartyIntent = { type: 'rename', animalId: animal.id, nickname: raw };
					const step = applyPartyIntent(party, intent, 'explore');
					const clean = normalizeNickname(raw);
					expect(step.events).toEqual([{ type: 'renamed', animalId: animal.id, nickname: clean }]);
					const renamed = step.party.find((a) => a.id === animal.id)!;
					const { nickname: _old, ...rest } = animal;
					expect(renamed).toEqual(clean === null ? rest : { ...rest, nickname: clean });
					expect('nickname' in renamed).toBe(clean !== null);
					expect(animalName(renamed)).toBe(clean ?? getAnimal(animal.speciesId).name);
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
			const intent = { type: 'rename', animalId: party[0]!.id, nickname } as unknown as PartyIntent;
			expectRejected(party, applyPartyIntent(party, intent, 'explore'));
		}
		expectRejected(
			party,
			applyPartyIntent(party, { type: 'rename', animalId: 'nobody', nickname: 'Pip' }, 'explore')
		);
	});
});

describe('applyPartyIntent: when', () => {
	it('changes nothing outside explore, whatever the intent', () => {
		for (const activity of ['battle', 'doctor', 'shopping'] as PlayerActivity[]) {
			for (const party of PARTIES.slice(0, 40)) {
				const animal = party.at(-1)!;
				const intents: PartyIntent[] = [
					{ type: 'reorder', animalId: animal.id, to: 0 },
					{ type: 'rename', animalId: animal.id, nickname: 'Pip' },
					{ type: 'rename', animalId: animal.id, nickname: '' }
				];
				for (const intent of intents) {
					expectRejected(party, applyPartyIntent(party, intent, activity));
				}
			}
		}
	});

	it('refuses anything that is not a party intent', () => {
		const party = PARTIES[0]!;
		for (const intent of [null, undefined, 42, 'reorder', {}, { type: 'fly' }]) {
			expectRejected(party, applyPartyIntent(party, intent as unknown as PartyIntent, 'explore'));
		}
	});

	it('keeps every animal, its HP and a clean name through any run of edits', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const rng = new Rng(hashInts(0xed17, seed));
			let party: readonly AnimalInstance[] = deepFreeze(randomParty(rng));
			const hp = new Map(party.map((a) => [a.id, a.hp]));
			for (let i = 0; i < 30; i++) {
				const animal = rng.pick(party);
				const intent: PartyIntent =
					rng.next() < 0.5
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
