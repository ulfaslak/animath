import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, Realm } from '../src/animals/types.js';
import { takeToDoctor } from '../src/doctor/knockout.js';
import {
	canGoHome,
	keepsATeam,
	kindGoingHome,
	mustStay,
	needsHealing
} from '../src/doctor/party.js';
import { applyDoctorIntent, startDoctorVisit } from '../src/doctor/reducer.js';
import { homeTokens, tokenPuzzle, tokensForTier } from '../src/doctor/tokens.js';
import type { DoctorEvent, DoctorIntent, DoctorState, DoctorStep } from '../src/doctor/types.js';
import { ITEMS, ITEM_IDS, getItem, hasItem, itemsForSale } from '../src/items/catalog.js';
import { healingDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer } from '../src/puzzles/registry.js';
import { Rng, hashInts, hashString } from '../src/rng.js';
import { WorldEdits, editedTileAt } from '../src/world/edits.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { TENT_SEARCH_STEPS, canTalkToDoctor, nearestTent } from '../src/world/tents.js';
import { isWalkable, isWater, step, type Direction, type GridPos } from '../src/world/types.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';
import { wordedStrings } from './words.js';

const SEEDS = 25;
const PROTOTYPE = hashString('prototype');

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

function maxHp(animal: AnimalInstance): number {
	return getAnimal(animal.speciesId).maxHp;
}

/** A party of the given species at the given HP (full when not given). */
function partyOf(...members: [speciesId: string, hp?: number][]): AnimalInstance[] {
	return members.map(([speciesId, hp], i) => ({
		id: `${speciesId}-${i}`,
		speciesId,
		hp: hp ?? getAnimal(speciesId).maxHp
	}));
}

/**
 * Apply an intent to a frozen state and check what every accepted doctor step
 * must keep: HP changes only with a `healed` event; animals leave only on a
 * right answer to a hand-over's sum, exactly the ones it named, never the last
 * one; tokens move only on a right answer to a token sum, by exactly the
 * reward or the price, and never below 0; an item arrives only when bought.
 */
function apply(state: DoctorState, intent: DoctorIntent, seed: number): DoctorStep {
	const step = applyDoctorIntent(deepFreeze(state), intent, seed);
	if (step.events[0]?.type === 'rejected') {
		expect(step.state).toBe(state);
		expect(step.events).toHaveLength(1);
		return step;
	}
	const after = step.state;
	expect(after.step).toBe(state.step + 1);
	expect(after).not.toHaveProperty('seed');
	expect(after.shop).toEqual(state.shop);
	const correct = step.events.some((e) => e.type === 'answer-judged' && e.correct);

	const home = step.events.find((e) => e.type === 'went-home');
	const leaving = new Set(home?.type === 'went-home' ? home.animals.map((a) => a.id) : []);
	if (home?.type === 'went-home') {
		expect(correct, 'animals left without a right answer').toBe(true);
		if (state.phase.kind !== 'handing-over') throw new Error('went home with no hand-over open');
		expect(home.animals.map((a) => a.id)).toEqual(state.phase.ids);
		for (const a of home.animals) expect(a.hp, 'goes home better').toBe(maxHp(a));
		// Somebody standing always stays: the team can still battle, and no reload rests it for free.
		expect(
			after.party.some((a) => a.hp > 0),
			'nobody standing stayed'
		).toBe(true);
	}
	const staying = state.party.filter((a) => !leaving.has(a.id));
	expect(after.party.map((a) => a.id)).toEqual(staying.map((a) => a.id));
	for (const [i, animal] of after.party.entries()) {
		const before = staying[i]!;
		expect(animal.hp).toBeGreaterThanOrEqual(before.hp);
		expect(animal.hp).toBeLessThanOrEqual(maxHp(animal));
		const healed = step.events.some((e) => e.type === 'healed' && e.partyIndex === i);
		expect(animal.hp, `animal ${i} changed without a healed event`).toBe(
			healed ? maxHp(animal) : before.hp
		);
	}

	const given = step.events.find((e) => e.type === 'tokens-given');
	const bought = step.events.find((e) => e.type === 'bought');
	let tokens = state.tokens;
	if (given?.type === 'tokens-given') {
		expect(correct, 'tokens given without a right answer').toBe(true);
		if (state.phase.kind !== 'handing-over') throw new Error('tokens given with no hand-over open');
		expect(given.amount).toBe(state.phase.reward);
		tokens += given.amount;
		expect(given.tokens).toBe(tokens);
	}
	if (bought?.type === 'bought') {
		expect(correct, 'bought without a right answer').toBe(true);
		if (state.phase.kind !== 'buying') throw new Error('bought with no purchase open');
		expect(bought.itemId).toBe(state.phase.itemId);
		expect(bought.price).toBe(getItem(bought.itemId).price);
		tokens -= bought.price;
		expect(bought.tokens).toBe(tokens);
		expect(after.items).toEqual([...state.items, bought.itemId]);
	} else {
		expect(after.items).toEqual(state.items);
	}
	expect(after.tokens).toBe(tokens);
	expect(after.tokens).toBeGreaterThanOrEqual(0);
	return step;
}

function solving(state: DoctorState) {
	if (state.phase.kind !== 'solving')
		throw new Error(`expected a puzzle, phase is ${state.phase.kind}`);
	return state.phase;
}

/** Wrong answers to a puzzle whose answer is `a` (a whole number ≥ 0), one per shape of mistake. */
const WRONG_INPUTS: readonly ((a: number) => string)[] = [
	() => '',
	() => '   ',
	() => 'x',
	(a) => String(a + 1),
	(a) => String(-a - 1),
	(a) => `${a}.5`,
	(a) => `${a}1`,
	() => '1e3',
	(a) => `${a} ${a}`
];

describe('startDoctorVisit', () => {
	it('copies the party, whoever is hurt, with no tokens, no items and the shop as it stands', () => {
		const party = partyOf(['squirrel', 0], ['fox']);
		const state = startDoctorVisit(party);
		expect(state).toEqual({
			step: 0,
			party,
			tokens: 0,
			items: [],
			shop: itemsForSale(),
			phase: { kind: 'choose-patient' }
		});
		expect(state.party[0]).not.toBe(party[0]);

		for (const healthy of [partyOf(['squirrel'], ['bear']), []]) {
			expect(startDoctorVisit(healthy)).toMatchObject({
				step: 0,
				party: healthy,
				phase: { kind: 'choose-patient' }
			});
		}
	});

	it("takes the player's tokens and items, and a shop in catalog order", () => {
		const items = ['boat', 'lantern'];
		const state = startDoctorVisit(partyOf(['fox']), {
			tokens: 30,
			items,
			shop: ['boat', 'axe', 'boat']
		});
		expect(state).toMatchObject({ tokens: 30, items, shop: ['axe', 'boat'] });
		expect(state.items).not.toBe(items);
		expect(hasItem(state, 'boat')).toBe(true);
		expect(hasItem(state, 'axe')).toBe(false);
	});

	it('carries no seed and no words: a client can neither predict a puzzle nor show English', () => {
		expect(Object.keys(startDoctorVisit(partyOf(['fox', 3]))).sort()).toEqual([
			'items',
			'party',
			'phase',
			'shop',
			'step',
			'tokens'
		]);
	});

	it('refuses tokens, items or a shop that cannot be real', () => {
		const party = partyOf(['fox']);
		for (const tokens of [-1, 1.5, NaN, '3' as unknown as number]) {
			expect(() => startDoctorVisit(party, { tokens }), String(tokens)).toThrow(/tokens/);
		}
		expect(() => startDoctorVisit(party, { items: [3] as unknown as string[] })).toThrow(/items/);
		expect(() => startDoctorVisit(party, { shop: ['sword'] as unknown as [] })).toThrow(/shop/);
	});

	it('refuses a party that cannot be real', () => {
		const bad: unknown[] = [
			partyOf(['squirrel', -1]),
			partyOf(['squirrel', 21]),
			partyOf(['squirrel', 1.5]),
			partyOf(['squirrel', NaN]),
			[{ id: 'x', speciesId: 'dragon', hp: 1 }],
			[
				{ id: 'twin', speciesId: 'fox', hp: 1 },
				{ id: 'twin', speciesId: 'rabbit', hp: 1 }
			],
			[null],
			'squirrel'
		];
		for (const party of bad) {
			expect(() => startDoctorVisit(party as AnimalInstance[]), JSON.stringify(party)).toThrow();
		}
	});
});

describe('applyDoctorIntent', () => {
	it('insists on a 32-bit unsigned integer seed', () => {
		const start = startDoctorVisit(partyOf(['squirrel', 0]));
		const leave: DoctorIntent = { type: 'leave' };
		for (const seed of [-1, 1.5, NaN, 2 ** 32, Infinity]) {
			expect(() => applyDoctorIntent(start, leave, seed), String(seed)).toThrow(/seed/);
		}
		for (const seed of [0, 1, 0xffffffff])
			expect(applyDoctorIntent(start, leave, seed).state.phase.kind).toBe('ended');
	});

	it('rejects a missing intent instead of throwing', () => {
		const start = deepFreeze(startDoctorVisit(partyOf(['squirrel', 0])));
		for (const bad of [undefined, null, 42, 'leave']) {
			const step = applyDoctorIntent(start, bad as unknown as DoctorIntent, 1);
			expect(step.state).toBe(start);
			expect(step.events).toEqual([{ type: 'rejected', reason: 'not-an-intent' }]);
		}
	});

	it('rejects what does not fit, leaving the state untouched', () => {
		const start = startDoctorVisit(partyOf(['squirrel', 0], ['rabbit']));
		const rejected = (state: DoctorState, intent: DoctorIntent) => {
			const step = applyDoctorIntent(deepFreeze(state), intent, 9);
			expect(step.state).toBe(state);
			expect(step.events).toEqual([{ type: 'rejected', reason: expect.any(String) }]);
			return (step.events[0] as { reason: string }).reason;
		};
		expect(rejected(start, { type: 'pick-patient', partyIndex: 1 })).toBe('not-hurt');
		for (const partyIndex of [
			-1,
			2,
			0.5,
			NaN,
			'0' as unknown as number,
			undefined as unknown as number
		])
			expect(rejected(start, { type: 'pick-patient', partyIndex })).toBe('no-such-animal');
		expect(rejected(start, { type: 'answer', input: '4' })).toBe('no-puzzle');
		expect(rejected(start, { type: 'heal-everyone' } as unknown as DoctorIntent)).toBe(
			'not-an-intent'
		);

		const puzzle = applyDoctorIntent(start, { type: 'pick-patient', partyIndex: 0 }, 9).state;
		expect(rejected(puzzle, { type: 'pick-patient', partyIndex: 1 })).toBe('not-hurt');

		const ended = applyDoctorIntent(puzzle, { type: 'leave' }, 9).state;
		for (const intent of [
			{ type: 'pick-patient', partyIndex: 0 },
			{ type: 'answer', input: String(solving(puzzle).puzzle.answer) },
			{ type: 'leave' }
		] as DoctorIntent[])
			expect(rejected(ended, intent)).toBe('visit-over');
	});
});

describe('healing, for every species', () => {
	for (const spec of ANIMALS) {
		it(`${spec.id}: a puzzle at its healing difficulty; a wrong answer changes nothing; a right one heals it to full`, () => {
			const kinds = new Set(spec.attacks.flatMap((a) => a.kinds));
			// A hurt animal of another species beside it, which the heal leaves alone.
			const other = spec.id === 'fox' ? 'otter' : 'fox';
			for (const hp of [0, 1, spec.maxHp - 1]) {
				for (let seed = 0; seed < SEEDS; seed++) {
					let state = startDoctorVisit(partyOf([spec.id, hp], [other, 7], ['rabbit']));
					let s = apply(state, { type: 'pick-patient', partyIndex: 0 }, seed);
					state = s.state;
					expect(s.events).toEqual([
						{ type: 'puzzle-shown', partyIndex: 0, puzzle: solving(state).puzzle }
					]);

					for (const wrong of WRONG_INPUTS) {
						const puzzle = solving(state).puzzle;
						const input = wrong(puzzle.answer);
						expect(puzzle.difficulty).toBe(healingDifficulty(spec.tier));
						expect(kinds.has(puzzle.kind), `${puzzle.kind} is not a ${spec.id} kind`).toBe(true);
						s = apply(state, { type: 'answer', input }, seed);
						const judged = s.events[0] as Extract<DoctorEvent, { type: 'answer-judged' }>;
						expect(judged).toEqual({
							type: 'answer-judged',
							input,
							correct: false,
							answer: puzzle.answer
						});
						expect(checkAnswer(puzzle, input)).toBe(false);
						expect(s.events[1]).toMatchObject({ type: 'puzzle-shown', partyIndex: 0 });
						expect(s.state.party).toEqual(state.party);
						expect(solving(s.state).puzzle.prompt).not.toBe(puzzle.prompt);
						state = s.state;
					}

					const { puzzle } = solving(state);
					s = apply(state, { type: 'answer', input: ` +${puzzle.answer} ` }, seed);
					expect(s.events).toEqual([
						{
							type: 'answer-judged',
							input: ` +${puzzle.answer} `,
							correct: true,
							answer: puzzle.answer
						},
						{
							type: 'healed',
							partyIndex: 0,
							animal: { id: `${spec.id}-0`, speciesId: spec.id, hp: spec.maxHp }
						}
					]);
					expect(s.state.party.map((a) => a.hp)).toEqual([
						spec.maxHp,
						7,
						getAnimal('rabbit').maxHp
					]);
					expect(s.state.phase).toEqual({ kind: 'choose-patient' });
				}
			}
			// Up to 2 s alone per species (three HP levels, 25 seeds, every shape of wrong
			// answer); nearly 3 s with two browsers drawing beside it.
		}, 30_000);
	}

	it('judges only with checkAnswer, whatever the input', () => {
		const rng = new Rng(7);
		const junk = [
			'٣',
			'0x10',
			'--4',
			'+-4',
			'4.',
			'.4',
			'Infinity',
			'9'.repeat(40),
			'\t12\n',
			'007',
			'-0'
		];
		let right = 0;
		let wrong = 0;
		for (let seed = 0; seed < SEEDS; seed++) {
			let state = startDoctorVisit(partyOf(['wolf', 0]));
			state = apply(state, { type: 'pick-patient', partyIndex: 0 }, seed).state;
			for (let i = 0; i < 40; i++) {
				const { puzzle } = solving(state);
				const near = puzzle.answer + rng.int(-2, 2);
				const input = rng.chance(0.5)
					? rng.pick(junk)
					: rng.pick([String(near), ` ${near}`, `+${near}`, `0${near}`]);
				const s = apply(state, { type: 'answer', input }, seed);
				const correct = checkAnswer(puzzle, input);
				expect(s.events[0]).toEqual({
					type: 'answer-judged',
					input,
					correct,
					answer: puzzle.answer
				});
				expect(s.state.party[0]!.hp).toBe(correct ? getAnimal('wolf').maxHp : 0);
				if (correct) {
					right++;
					break;
				}
				wrong++;
				state = s.state;
			}
		}
		expect(right).toBeGreaterThan(0);
		expect(wrong).toBeGreaterThan(0);
	});

	it("one right answer heals every hurt animal of the patient's species, and no other", () => {
		let state = startDoctorVisit(
			partyOf(
				['squirrel', 0],
				['bear', 30],
				['squirrel', 5],
				['otter', 0],
				['squirrel'],
				['deer', 1]
			)
		);
		const seed = 5;
		// The squirrel at 5 is picked; the tired one heals with it, the fit one has nothing to heal.
		for (const [partyIndex, heals] of [
			[2, [0, 2]],
			[3, [3]],
			[1, [1]]
		] as const) {
			const before = state.party.map((a) => a.hp);
			state = apply(state, { type: 'pick-patient', partyIndex }, seed).state;
			expect(solving(state).puzzle.difficulty).toBe(
				healingDifficulty(getAnimal(state.party[partyIndex]!.speciesId).tier)
			);
			const s = apply(state, { type: 'answer', input: String(solving(state).puzzle.answer) }, seed);
			state = s.state;
			expect(s.events.flatMap((e) => (e.type === 'healed' ? [e.partyIndex] : []))).toEqual([
				...heals
			]);
			const changed = state.party.flatMap((a, i) => (a.hp !== before[i] ? [i] : []));
			expect(changed).toEqual([...heals]);
		}
		expect(state.party.map((a) => needsHealing(a))).toEqual([
			false,
			false,
			false,
			false,
			false,
			true
		]);
	});

	it('picking another animal mid-puzzle swaps the puzzle, at no cost', () => {
		const start = startDoctorVisit(partyOf(['squirrel', 3], ['bear', 3]));
		const first = apply(start, { type: 'pick-patient', partyIndex: 0 }, 1).state;
		const swapped = apply(first, { type: 'pick-patient', partyIndex: 1 }, 1);
		expect(solving(swapped.state).partyIndex).toBe(1);
		expect(solving(swapped.state).puzzle.difficulty).toBe(healingDifficulty(5));
		expect(swapped.state.party).toEqual(start.party);
	});

	it('can always be left, from the list or from a puzzle', () => {
		const start = startDoctorVisit(partyOf(['fox', 0]));
		const puzzle = apply(start, { type: 'pick-patient', partyIndex: 0 }, 3).state;
		for (const state of [start, puzzle]) {
			const s = apply(state, { type: 'leave' }, 3);
			expect(s.events).toEqual([{ type: 'ended' }]);
			expect(s.state.phase).toEqual({ kind: 'ended' });
			expect(s.state.party).toEqual(start.party);
		}
	});
});

describe('tokens', () => {
	it('an animal of tier k brings k·(k + 1): bigger animals bring strictly more', () => {
		expect([1, 2, 3, 4, 5].map(tokensForTier)).toEqual([2, 6, 12, 20, 30]);
		for (const bad of [0, 6, 1.5, NaN]) expect(() => tokensForTier(bad)).toThrow(/tier/);
		for (const a of ANIMALS)
			for (const b of ANIMALS) {
				if (a.tier > b.tier) expect(tokensForTier(a.tier)).toBeGreaterThan(tokensForTier(b.tier));
			}
		expect(homeTokens(partyOf(['squirrel', 0], ['fox'], ['bear', 3]))).toBe(2 + 6 + 30);
		expect(homeTokens([])).toBe(0);
	});

	it('a token sum is the real numbers: the balance, plus what comes in or less what goes out', () => {
		for (let balance = 0; balance <= 120; balance++) {
			for (const change of [1, 2, 6, 30, 91, -1, -8, -13, -21]) {
				if (balance + change < 0) {
					expect(() => tokenPuzzle(balance, change)).toThrow();
					continue;
				}
				const p = tokenPuzzle(balance, change);
				const sign = change > 0 ? '+' : '−';
				expect(p).toMatchObject({
					kind: change > 0 ? 'add' : 'sub',
					prompt: `${balance} ${sign} ${Math.abs(change)} = ?`,
					answer: balance + change
				});
				expect(checkAnswer(p, String(balance + change))).toBe(true);
				expect(p.difficulty).toBeGreaterThanOrEqual(1);
				expect(p.difficulty).toBeLessThanOrEqual(10);
			}
		}
		// The difficulty is the addition band of the bigger number, the scale a kid meets in battle.
		expect(tokenPuzzle(0, 5).difficulty).toBe(1);
		expect(tokenPuzzle(23, -8).difficulty).toBe(4);
		expect(tokenPuzzle(150, 30).difficulty).toBe(6);
		for (const [balance, change] of [
			[0, 0],
			[3, -4],
			[-1, 2],
			[1.5, 1],
			[2, 0.5]
		] as const)
			expect(() => tokenPuzzle(balance, change), `${balance} ${change}`).toThrow();
	});
});

describe('the shop', () => {
	it('sells three tools with stable ids, cheapest first, each at a price a kid can count to', () => {
		expect(ITEM_IDS).toEqual(['axe', 'pickaxe', 'boat']);
		const prices = ITEMS.map((i) => i.price);
		for (const [i, price] of prices.entries()) {
			expect(Number.isInteger(price) && price > 0 && price < 100).toBe(true);
			if (i > 0) expect(price).toBeGreaterThan(prices[i - 1]!);
		}
		expect(() => getItem('sword' as 'axe')).toThrow();
	});

	it('sells nothing whose effect is not built: a kid never pays for a tool that does nothing', () => {
		// The change that builds an item's effect (chopping, breaking rocks, sailing)
		// turns its `available` on and adds it here, and nothing else does. The axe
		// and the pickaxe clear trees and rocks (`world/clearing.ts`); the boat
		// sails: water is passable with it.
		expect(itemsForSale()).toEqual(['axe', 'pickaxe', 'boat']);
	});
});

/** A visit with the whole catalog for sale, so the shop's rules can be tried before any item is. */
function shopVisit(party: AnimalInstance[], tokens: number, items: string[] = []): DoctorState {
	return startDoctorVisit(party, { tokens, items, shop: ITEM_IDS });
}

/** The open token sum's phase. */
function trading(state: DoctorState) {
	if (state.phase.kind !== 'handing-over' && state.phase.kind !== 'buying')
		throw new Error(`expected a token sum, phase is ${state.phase.kind}`);
	return state.phase;
}

describe('helping animals home', () => {
	it('asks the tokens you will have: the balance plus what they bring, tired animals included', () => {
		const party = partyOf(['squirrel', 0], ['fox', 12], ['rabbit'], ['bear']);
		const start = startDoctorVisit(party, { tokens: 12 });
		const s = apply(start, { type: 'hand-over', ids: ['bear-3', 'squirrel-0'] }, 4);
		const phase = trading(s.state);
		// In party order, whatever order the kid picked them in.
		expect(phase).toEqual({
			kind: 'handing-over',
			ids: ['squirrel-0', 'bear-3'],
			reward: 2 + 30,
			puzzle: tokenPuzzle(12, 32)
		});
		expect(phase.puzzle.prompt).toBe('12 + 32 = ?');
		expect(s.events).toEqual([
			{ type: 'hand-over-shown', ids: ['squirrel-0', 'bear-3'], reward: 32, puzzle: phase.puzzle }
		]);
		expect(s.state.party).toEqual(party);
		expect(s.state.tokens).toBe(12);
	});

	it('a wrong answer asks the same sum again and changes nothing; a right one sends them home and pays', () => {
		const party = partyOf(['squirrel', 0], ['fox', 12], ['rabbit']);
		let state = apply(
			startDoctorVisit(party, { tokens: 5 }),
			{ type: 'hand-over', ids: ['fox-1', 'squirrel-0'] },
			2
		).state;
		const { puzzle } = trading(state);
		for (const wrong of WRONG_INPUTS) {
			const input = wrong(puzzle.answer);
			const s = apply(state, { type: 'answer', input }, 2);
			expect(s.events).toEqual([
				{ type: 'answer-judged', input, correct: false, answer: puzzle.answer }
			]);
			expect(trading(s.state)).toEqual(trading(state));
			expect(s.state.party).toEqual(party);
			expect(s.state.tokens).toBe(5);
			state = s.state;
		}
		const s = apply(state, { type: 'answer', input: '13' }, 2);
		expect(s.events).toEqual([
			{ type: 'answer-judged', input: '13', correct: true, answer: 13 },
			{
				type: 'went-home',
				animals: [
					{ id: 'squirrel-0', speciesId: 'squirrel', hp: 20 },
					{ id: 'fox-1', speciesId: 'fox', hp: 35 }
				]
			},
			{ type: 'tokens-given', amount: 8, tokens: 13 }
		]);
		expect(s.state.party).toEqual([party[2]]);
		expect(s.state.tokens).toBe(13);
		expect(s.state.phase).toEqual({ kind: 'choose-patient' });
	});

	it('never takes the last animal standing, nor an animal twice, nor one that is not there', () => {
		const party = partyOf(['squirrel', 0], ['fox'], ['rabbit']);
		const start = startDoctorVisit(party, { tokens: 3 });
		const reason = (ids: unknown, from = start) => {
			const s = apply(from, { type: 'hand-over', ids: ids as string[] }, 1);
			return s.events[0]?.type === 'rejected' ? s.events[0].reason : 'accepted';
		};
		expect(reason(['squirrel-0', 'fox-1', 'rabbit-2'])).toBe('keep-one');
		expect(reason(['squirrel-0', 'fox-1'])).toBe('accepted');
		// Keeping only the tired squirrel is keeping nobody who can battle.
		expect(reason(['fox-1', 'rabbit-2'])).toBe('keep-one');
		expect(reason(['fox-1'])).toBe('accepted');
		const tiredButOne = startDoctorVisit(partyOf(['squirrel', 0], ['otter', 0], ['fox', 1]));
		expect(reason(['fox-2'], tiredButOne)).toBe('keep-one');
		expect(reason(['squirrel-0', 'otter-1'], tiredButOne)).toBe('accepted');
		// Nobody standing at all (a `?party=` of tired animals): nobody can go until one is healed.
		const allTired = startDoctorVisit(partyOf(['squirrel', 0], ['fox', 0]));
		expect(reason(['squirrel-0'], allTired)).toBe('keep-one');
		for (const bad of [[], ['wolf-9'], ['fox-1', 'fox-1'], [1], 'fox-1', undefined, null, [null]]) {
			expect(reason(bad), JSON.stringify(bad)).toBe('no-such-animal');
		}
		// A party of one has nobody to spare.
		const alone = startDoctorVisit(partyOf(['squirrel', 0]));
		const s = apply(alone, { type: 'hand-over', ids: ['squirrel-0'] }, 1);
		expect(s.events).toEqual([{ type: 'rejected', reason: 'keep-one' }]);
		// The tent stands on land: a crab or a whale standing is nobody to walk on with, so one
		// that can fight on land stays too. A frog swims and walks: it will do.
		const seaside = startDoctorVisit(partyOf(['squirrel'], ['crab'], ['whale'], ['frog']));
		expect(reason(['squirrel-0', 'frog-3'], seaside)).toBe('keep-one');
		expect(reason(['squirrel-0', 'crab-1', 'whale-2'], seaside)).toBe('accepted');
		expect(reason(['squirrel-0'], seaside)).toBe('accepted');
		expect(reason(['crab-1', 'whale-2', 'frog-3'], seaside)).toBe('accepted');
		const onlySea = startDoctorVisit(partyOf(['crab'], ['squirrel', 0]));
		expect(reason(['squirrel-1'], onlySea)).toBe('keep-one');
	});
});

describe('helping a whole kind home', () => {
	/** `n` foxes at full HP, `fox-0` first. */
	const foxes = (n: number) => partyOf(...Array.from({ length: n }, () => ['fox'] as [string]));
	const idsOf = (animals: readonly AnimalInstance[]) => animals.map((a) => a.id);

	it('picks every one of the kind; when nobody else is standing, the first of them standing stays', () => {
		const forty = foxes(40);
		// Forty foxes and nobody else: all but the first go, so one who isn't tired stays.
		expect(kindGoingHome(forty, [], 'fox')).toEqual(idsOf(forty.slice(1)));
		// Beside a squirrel standing, all forty go.
		const squirrel: AnimalInstance = { id: 'sq', speciesId: 'squirrel', hp: 3 };
		expect(kindGoingHome([...forty, squirrel], [], 'fox')).toEqual(idsOf(forty));
		// The squirrel picked first: a fox stays again. A tired squirrel is nobody standing.
		expect(kindGoingHome([...forty, squirrel], ['sq'], 'fox')).toEqual(idsOf(forty.slice(1)));
		expect(kindGoingHome([...forty, { ...squirrel, hp: 0 }], [], 'fox')).toEqual(
			idsOf(forty.slice(1))
		);
		// The first fox tired: it goes, and the first one standing stays.
		const tiredFirst = partyOf(['fox', 0], ['fox', 5], ['fox'], ['squirrel', 0]);
		expect(kindGoingHome(tiredFirst, [], 'fox')).toEqual(['fox-0', 'fox-2']);
		// A fox the kid picked stays picked; of the rest, the first standing stays.
		expect(kindGoingHome(tiredFirst, ['fox-1'], 'fox')).toEqual(['fox-0']);
		// Nothing more can join: the whole kind picked, or all but the one who stays.
		expect(kindGoingHome([...forty, squirrel], idsOf(forty), 'fox')).toEqual([]);
		expect(kindGoingHome(forty, idsOf(forty.slice(1)), 'fox')).toEqual([]);
		// Nobody standing at all (a `?party=` of tired animals): nobody may go.
		expect(kindGoingHome(partyOf(['fox', 0], ['fox', 0]), [], 'fox')).toEqual([]);
		// A kind the team doesn't have.
		expect(kindGoingHome(forty, [], 'bear')).toEqual([]);
		// Who has to stay: nobody while two not picked are standing, then the last of them,
		// and every one not picked when none of them is standing.
		expect(mustStay(forty, [])).toEqual([]);
		expect(mustStay(forty, idsOf(forty.slice(1)))).toEqual(['fox-0']);
		expect(mustStay(tiredFirst, ['fox-1'])).toEqual(['fox-2']);
		expect(mustStay(partyOf(['fox', 0], ['fox', 0]), [])).toEqual(['fox-0', 'fox-1']);
	});

	it('a sea animal is no one to walk on with: handing over every walker and keeping only sea animals is refused', () => {
		const party = partyOf(['fox'], ['fox'], ['crab'], ['crab'], ['whale']);
		// Every fox going leaves only sea animals standing, which could battle nothing on land.
		expect(canGoHome(party, ['fox-0', 'fox-1'])).toBe(false);
		const visit = startDoctorVisit(party);
		expect(apply(visit, { type: 'hand-over', ids: ['fox-0', 'fox-1'] }, 1).events).toEqual([
			{ type: 'rejected', reason: 'keep-one' }
		]);
		// So the foxes' row keeps the first fox, and the last fox has to stay once the other is picked.
		expect(kindGoingHome(party, [], 'fox')).toEqual(['fox-1']);
		expect(mustStay(party, ['fox-1'])).toEqual(['fox-0']);
		// The sea animals may all go: a fox stays to walk on with the kid.
		expect(kindGoingHome(party, ['fox-1'], 'crab')).toEqual(['crab-2', 'crab-3']);
		expect(kindGoingHome(party, [], 'whale')).toEqual(['whale-4']);
		expect(
			apply(visit, { type: 'hand-over', ids: ['fox-1', 'crab-2', 'crab-3', 'whale-4'] }, 1)
				.events[0]?.type
		).toBe('hand-over-shown');
		// The foxes tired and the sea animals standing: nobody can walk on, so nobody may go.
		const tiredFoxes = partyOf(['fox', 0], ['fox', 0], ['crab'], ['whale']);
		expect(kindGoingHome(tiredFoxes, [], 'crab')).toEqual([]);
		expect(kindGoingHome(tiredFoxes, [], 'fox')).toEqual([]);
		expect(mustStay(tiredFoxes, [])).toEqual(['fox-0', 'fox-1', 'crab-2', 'whale-3']);
		// The frog swims and walks: it keeps a team on land on its own.
		const frogAndCrab = partyOf(['frog'], ['crab']);
		expect(kindGoingHome(frogAndCrab, [], 'crab')).toEqual(['crab-1']);
		expect(mustStay(frogAndCrab, [])).toEqual(['frog-0']);
	});

	it('over random teams: picks all it may, never the last one standing, and the reducer takes it', () => {
		const species = ANIMALS.map((a) => a.id);
		const bad: string[] = [];
		const note = (what: string, party: readonly AnimalInstance[], picked: readonly string[]) => {
			if (bad.length < 20) bad.push(`${what}: ${JSON.stringify({ party, picked })}`);
		};
		for (let seed = 0; seed < 400; seed++) {
			const rng = new Rng(hashInts(seed, 0x4b1d));
			// A team of 1 to 16 in any order, some of them tired.
			const party: AnimalInstance[] = Array.from({ length: rng.int(1, 16) }, (_, i) => {
				const speciesId = rng.pick(species.slice(0, rng.int(1, species.length)));
				const max = getAnimal(speciesId).maxHp;
				return { id: `a${i}`, speciesId, hp: rng.chance(0.35) ? 0 : rng.int(1, max) };
			});
			// Who could walk on with the kid, by the rule's own words: not tired, and at home on land.
			const walks = (a: AnimalInstance) => a.hp > 0 && canFightIn(a.speciesId, 'land');
			const standing = party.some(walks);
			for (let round = 0; round < 4; round++) {
				// Some picked already, as a kid's picks on the card: none, some, or every one.
				const odds = [0, 0.3, 0.7, 1][round]!;
				const picked = idsOf(party.filter(() => rng.chance(odds)));
				// The ones who stay keep a team exactly when one of them walks.
				const staying = party.filter((a) => !picked.includes(a.id));
				if (keepsATeam(staying) !== staying.some(walks)) note('not a team', party, picked);
				// Who has to stay is who can't join the picks by the rule itself.
				const refused = party.filter(
					(a) => !picked.includes(a.id) && !canGoHome(party, [...picked, a.id])
				);
				if (JSON.stringify(mustStay(party, picked)) !== JSON.stringify(idsOf(refused)))
					note('not who has to stay', party, picked);
				for (const speciesId of new Set(party.map((a) => a.speciesId))) {
					const joins = kindGoingHome(party, picked, speciesId);
					const rest = party.filter((a) => a.speciesId === speciesId && !picked.includes(a.id));
					const after = [...picked, ...joins];
					// Only animals of the kind not picked yet, each once, in party order.
					const expected = idsOf(rest).filter((id) => joins.includes(id));
					if (JSON.stringify(joins) !== JSON.stringify(expected))
						note('not the kind, in party order', party, picked);
					// Never so many that nobody standing stays.
					if (joins.length > 0 && !canGoHome(party, after))
						note('left nobody standing', party, picked);
					// As many as may go: nothing more of the kind can join after it.
					if (kindGoingHome(party, after, speciesId).length > 0)
						note('could pick more', party, picked);
					// At most one of the kind stays, and only one who must: the first of the rest who walks.
					const left = rest.filter((a) => !joins.includes(a.id));
					if (canGoHome(party, picked) && standing) {
						const all = [...picked, ...idsOf(rest)];
						const stays = canGoHome(party, all) ? [] : [rest.find(walks)!];
						if (JSON.stringify(idsOf(left)) !== JSON.stringify(idsOf(stays)))
							note('the wrong one stays', party, picked);
					}
					// The reducer takes the same picks, and refuses the whole kind exactly when one stays.
					if (after.length > 0 && joins.length > 0) {
						const visit = startDoctorVisit(party);
						const take = applyDoctorIntent(visit, { type: 'hand-over', ids: after }, seed);
						if (take.events[0]?.type !== 'hand-over-shown')
							note('the reducer refused', party, picked);
						if (left.length > 0) {
							const whole = [...picked, ...idsOf(rest)];
							const refused = applyDoctorIntent(visit, { type: 'hand-over', ids: whole }, seed);
							if (refused.events[0]?.type !== 'rejected')
								note('one stayed for nothing', party, picked);
						}
					}
				}
			}
		}
		expect(bad).toEqual([]);
	});
});

describe('buying', () => {
	it('asks the tokens you will have left, and only sells what the shop has, once, to a kid who can pay', () => {
		const party = partyOf(['fox']);
		const reason = (state: DoctorState, itemId: string) => {
			const s = apply(state, { type: 'buy', itemId }, 1);
			return s.events[0]?.type === 'rejected' ? s.events[0].reason : 'accepted';
		};
		// The shop sells what the visit's shop lists: by default what is on sale (all three tools).
		expect(reason(startDoctorVisit(party, { tokens: 99, shop: ['axe'] }), 'boat')).toBe(
			'not-for-sale'
		);
		expect(reason(startDoctorVisit(party, { tokens: 99 }), 'boat')).toBe('accepted');
		expect(reason(startDoctorVisit(party, { tokens: 99 }), 'axe')).toBe('accepted');
		const rich = shopVisit(party, 21, ['pickaxe']);
		expect(reason(rich, 'sword')).toBe('not-for-sale');
		expect(reason(rich, 42 as unknown as string)).toBe('not-for-sale');
		expect(reason(rich, 'pickaxe')).toBe('already-owned');
		expect(reason(rich, 'boat')).toBe('accepted');
		expect(reason(shopVisit(party, 20), 'boat')).toBe('not-enough-tokens');

		const s = apply(rich, { type: 'buy', itemId: 'axe' }, 1);
		const phase = trading(s.state);
		expect(phase).toEqual({ kind: 'buying', itemId: 'axe', price: 8, puzzle: tokenPuzzle(21, -8) });
		expect(phase.puzzle.prompt).toBe('21 − 8 = ?');
		expect(s.events).toEqual([
			{ type: 'purchase-shown', itemId: 'axe', price: 8, puzzle: phase.puzzle }
		]);
	});

	it('a wrong answer asks the same sum again and buys nothing; a right one buys it, to exactly the balance less the price', () => {
		for (const item of ITEMS) {
			for (const extra of [0, 1, 7, 50]) {
				const balance = item.price + extra;
				let state = apply(
					shopVisit(partyOf(['fox']), balance),
					{ type: 'buy', itemId: item.id },
					3
				).state;
				const { puzzle } = trading(state);
				expect(puzzle.answer).toBe(extra);
				for (const wrong of WRONG_INPUTS) {
					const s = apply(state, { type: 'answer', input: wrong(extra) }, 3);
					expect(trading(s.state)).toEqual(trading(state));
					expect(s.state.tokens).toBe(balance);
					expect(s.state.items).toEqual([]);
					state = s.state;
				}
				const s = apply(state, { type: 'answer', input: String(extra) }, 3);
				expect(s.events.at(-1)).toEqual({
					type: 'bought',
					itemId: item.id,
					price: item.price,
					tokens: extra
				});
				expect(s.state.tokens).toBe(extra);
				expect(s.state.items).toEqual([item.id]);
				expect(hasItem(s.state, item.id)).toBe(true);
				// One is all anyone needs.
				const again = apply(s.state, { type: 'buy', itemId: item.id }, 3);
				expect(again.events).toEqual([{ type: 'rejected', reason: 'already-owned' }]);
			}
		}
	});
});

describe('backing out', () => {
	it('back, another pick or leaving puts any open puzzle away, and nothing happens that was not answered', () => {
		const party = partyOf(['squirrel', 0], ['fox', 3], ['rabbit']);
		const start = shopVisit(party, 30);
		const opens: DoctorIntent[] = [
			{ type: 'pick-patient', partyIndex: 0 },
			{ type: 'hand-over', ids: ['fox-1'] },
			{ type: 'buy', itemId: 'boat' }
		];
		for (const open of opens) {
			const opened = apply(start, open, 6).state;
			const back = apply(opened, { type: 'back' }, 6);
			expect(back.events).toEqual([{ type: 'closed' }]);
			expect(back.state).toMatchObject({
				party,
				tokens: 30,
				items: [],
				phase: { kind: 'choose-patient' }
			});
			for (const other of opens) {
				const swapped = apply(opened, other, 6).state;
				expect(swapped.phase.kind).toBe(apply(start, other, 6).state.phase.kind);
				expect(swapped).toMatchObject({ party, tokens: 30, items: [] });
			}
			const left = apply(opened, { type: 'leave' }, 6).state;
			expect(left).toMatchObject({ party, tokens: 30, items: [], phase: { kind: 'ended' } });
		}
		expect(apply(start, { type: 'back' }, 6).events).toEqual([
			{ type: 'rejected', reason: 'no-puzzle' }
		]);
	});
});

/** A kid at the doctor: right with probability `accuracy`, picks hurt animals at random, sometimes walks off. */
function playVisit(seed: number, party: AnimalInstance[], accuracy: number, tokens = 0) {
	const rng = new Rng(hashInts(seed, 0xd0c));
	// The whole catalog on sale, so purchases happen before any item is on sale for real.
	let state = shopVisit(party, tokens);
	const events: DoctorEvent[] = [];
	const intents: DoctorIntent[] = [];
	for (let i = 0; i < 400 && state.phase.kind !== 'ended'; i++) {
		let intent: DoctorIntent;
		const phase = state.phase;
		if (phase.kind === 'solving' || phase.kind === 'handing-over' || phase.kind === 'buying') {
			const a = phase.puzzle.answer;
			// Now and then the kid backs out, or tries something else instead.
			intent = rng.chance(0.05)
				? { type: 'back' }
				: { type: 'answer', input: String(rng.chance(accuracy) ? a : a + 1) };
		} else {
			const hurt = [...state.party.keys()].filter((j) => needsHealing(state.party[j]!));
			const roll = rng.next();
			if (roll < 0.04) intent = { type: 'leave' };
			else if (roll < 0.3) {
				// Any animals at all, even every one of them (which is refused) or none.
				const ids = state.party.filter(() => rng.chance(0.4)).map((a) => a.id);
				intent = { type: 'hand-over', ids };
			} else if (roll < 0.5) intent = { type: 'buy', itemId: rng.pick(ITEM_IDS) };
			else if (hurt.length > 0) intent = { type: 'pick-patient', partyIndex: rng.pick(hurt) };
			else intent = rng.chance(0.3) ? { type: 'leave' } : { type: 'back' };
		}
		const s = apply(state, intent, seed);
		intents.push(intent);
		events.push(...s.events);
		state = s.state;
	}
	return { state, events, intents };
}

describe('replay', () => {
	it('the same seed, party and intents always yield the same states and events, and every visit ends', () => {
		const ids = ANIMALS.map((a) => a.id);
		const seen = new Set<string>();
		for (const [i, a] of ids.entries()) {
			const party = partyOf([a, 0], [ids[(i + 3) % ids.length]!, 1], ['squirrel', 5], [a]);
			for (let seed = 0; seed < 5; seed++) {
				const tokens = [0, 7, 21, 60][seed % 4]!;
				const first = playVisit(seed, party, 0.6, tokens);
				const again = playVisit(seed, party, 0.6, tokens);
				expect(again).toEqual(first);
				expect(first.state.phase.kind).toBe('ended');
				// The doctor's words are the client's: nothing here is a sentence.
				expect(wordedStrings(first)).toEqual([]);
				for (const e of first.events) seen.add(e.type === 'rejected' ? e.reason : e.type);
			}
		}
		// The kid did everything there is to do, and ran into every refusal a kid can.
		for (const what of [
			'healed',
			'went-home',
			'tokens-given',
			'bought',
			'closed',
			'keep-one',
			'already-owned',
			'not-enough-tokens',
			'no-such-animal'
		])
			expect(seen, what).toContain(what);
		// About 0.6 s alone (70 visits, each played twice); 3.9 s at a load average of 40.
	}, 30_000);

	it('a different seed asks different puzzles', () => {
		const prompts = new Set<string>();
		for (let seed = 0; seed < SEEDS; seed++) {
			const s = applyDoctorIntent(
				startDoctorVisit(partyOf(['fox', 0])),
				{ type: 'pick-patient', partyIndex: 0 },
				seed
			);
			prompts.add(solving(s.state).puzzle.prompt);
		}
		expect(prompts.size).toBeGreaterThan(5);
	});

	it('golden: a tired squirrel, a hurt fox and a healthy rabbit, seed 2024', () => {
		const party = partyOf(['squirrel', 0], ['fox', 12], ['rabbit']);
		const script: ((s: DoctorState) => DoctorIntent)[] = [
			() => ({ type: 'pick-patient', partyIndex: 2 }),
			() => ({ type: 'pick-patient', partyIndex: 0 }),
			(s) => ({ type: 'answer', input: String(solving(s).puzzle.answer + 1) }),
			(s) => ({ type: 'answer', input: String(solving(s).puzzle.answer) }),
			() => ({ type: 'pick-patient', partyIndex: 0 }),
			() => ({ type: 'pick-patient', partyIndex: 1 }),
			() => ({ type: 'answer', input: '' }),
			(s) => ({ type: 'answer', input: String(solving(s).puzzle.answer - 1) }),
			(s) => ({ type: 'answer', input: String(solving(s).puzzle.answer) }),
			() => ({ type: 'leave' }),
			() => ({ type: 'answer', input: '5' })
		];
		let state = startDoctorVisit(party);
		const events: DoctorEvent[] = [];
		for (const next of script) {
			const s = apply(state, next(state), 2024);
			events.push(...s.events);
			state = s.state;
		}

		expect(events.map((e) => e.type)).toEqual([
			'rejected',
			'puzzle-shown',
			'answer-judged',
			'puzzle-shown',
			'answer-judged',
			'healed',
			'rejected',
			'puzzle-shown',
			'answer-judged',
			'puzzle-shown',
			'answer-judged',
			'puzzle-shown',
			'answer-judged',
			'healed',
			'ended',
			'rejected'
		]);
		expect(events.filter((e) => e.type === 'healed' || e.type === 'rejected')).toEqual([
			{ type: 'rejected', reason: 'not-hurt' },
			{
				type: 'healed',
				partyIndex: 0,
				animal: { id: 'squirrel-0', speciesId: 'squirrel', hp: 20 }
			},
			{ type: 'rejected', reason: 'not-hurt' },
			{ type: 'healed', partyIndex: 1, animal: { id: 'fox-1', speciesId: 'fox', hp: 35 } },
			{ type: 'rejected', reason: 'visit-over' }
		]);
		expect(
			events
				.filter((e) => e.type === 'puzzle-shown')
				.map((e) => (e.type === 'puzzle-shown' ? e.puzzle.difficulty : 0))
		).toEqual([2, 2, 3, 3, 3]);
		expect(state).toEqual({
			step: 8,
			party: [
				{ id: 'squirrel-0', speciesId: 'squirrel', hp: 20 },
				{ id: 'fox-1', speciesId: 'fox', hp: 35 },
				{ id: 'rabbit-2', speciesId: 'rabbit', hp: 22 }
			],
			tokens: 0,
			items: [],
			shop: itemsForSale(),
			phase: { kind: 'ended' }
		});
	});
});

// --- the knock-out rule ------------------------------------------------------

/** `n` tall-grass tiles spread over 40 tiles around the spawn: where battles are actually lost. */
function grassNearSpawn(seed: number, n: number): GridPos[] {
	const spawn = spawnPoint(seed);
	const all: GridPos[] = [];
	for (let y = spawn.y - 40; y <= spawn.y + 40; y++)
		for (let x = spawn.x - 40; x <= spawn.x + 40; x++)
			if (tileAtWorld(seed, x, y).kind === 'tallgrass') all.push({ x, y });
	return Array.from({ length: n }, (_, i) => all[Math.floor((i * all.length) / n)]!);
}

function lostBattleParty(seed: number): AnimalInstance[] {
	const { state } = playBattle(seed, makeParty(['squirrel', 'rabbit']), makeWild('bear'), {
		accuracy: 0,
		policy: 'min'
	});
	expect(state.phase).toEqual({ kind: 'ended', outcome: 'lost' });
	return state.party.slice();
}

describe('takeToDoctor', () => {
	it('after a lost battle: beside the nearest tent, facing it, the whole party healed for free', () => {
		for (const seed of [PROTOTYPE, 3, 4]) {
			for (const [i, pos] of grassNearSpawn(seed, 8).entries()) {
				const party = deepFreeze(lostBattleParty(seed + i));
				const rescue = takeToDoctor(seed, deepFreeze(pos), party);
				const spot = nearestTent(seed, pos)!;
				expect(rescue).toEqual({
					pos: spot.stand,
					facing: spot.facing,
					tent: spot.tent,
					party: [
						{ id: 'squirrel-0', speciesId: 'squirrel', hp: 20 },
						{ id: 'rabbit-1', speciesId: 'rabbit', hp: 22 }
					]
				});
				expect(isWalkable(tileAtWorld(seed, rescue.pos.x, rescue.pos.y).kind)).toBe(true);
				expect(step(rescue.pos, rescue.facing)).toEqual(rescue.tent);
				expect(canTalkToDoctor(seed, rescue.pos, rescue.facing)).toBe(true);
				expect(takeToDoctor(seed, pos, party)).toEqual(rescue);
			}
		}
		// About 1 s alone (24 lost battles, three tent searches each); over 5 s under a heavy load.
	}, 30_000);

	it('keeps each animal as it was, nickname and extra fields included, only with full HP', () => {
		const party = [
			{ id: 'a', speciesId: 'otter', nickname: 'Splashy', hp: 0 },
			{ id: 'b', speciesId: 'wolf', hp: 0, caughtAt: 'river' } as AnimalInstance
		];
		expect(takeToDoctor(PROTOTYPE, spawnPoint(PROTOTYPE), deepFreeze(party)).party).toEqual([
			{ id: 'a', speciesId: 'otter', nickname: 'Splashy', hp: getAnimal('otter').maxHp },
			{ id: 'b', speciesId: 'wolf', hp: getAnimal('wolf').maxHp, caughtAt: 'river' }
		]);
	});

	it('when no tent can be reached, a doctor comes to the player where they are', () => {
		let walled: GridPos | null = null;
		for (let y = -200; y < 200 && !walled; y++)
			for (let x = -200; x < 200 && !walled; x++) {
				if (!isWalkable(tileAtWorld(PROTOTYPE, x, y).kind)) continue;
				const around = (['up', 'down', 'left', 'right'] as Direction[])
					.map((d) => step({ x, y }, d))
					.map((n) => tileAtWorld(PROTOTYPE, n.x, n.y).kind);
				if (around.every((k) => !isWalkable(k) && k !== 'tent')) walled = { x, y };
			}
		expect(walled).not.toBeNull();
		expect(takeToDoctor(PROTOTYPE, walled!, partyOf(['bear', 0]))).toEqual({
			pos: walled,
			facing: 'down',
			tent: null,
			party: partyOf(['bear'])
		});
	});

	it('out on the water with the boat: over the water to the nearest tent, stood on the ground beside it', () => {
		const spawn = spawnPoint(PROTOTYPE);
		const boat = { boat: true };
		let rescued = 0;
		for (let dy = -12; dy <= 12 && rescued < 8; dy += 3) {
			for (let dx = -40; dx <= 40 && rescued < 8; dx += 5) {
				const pos = { x: spawn.x + dx, y: spawn.y + dy };
				if (!isWater(tileAtWorld(PROTOTYPE, pos.x, pos.y).kind)) continue;
				rescued++;
				// The otter is tired; the squirrel, who can't swim, sat it out in the boat.
				const party = deepFreeze(partyOf(['squirrel', 20], ['otter', 0]));
				const rescue = takeToDoctor(PROTOTYPE, pos, party, WorldEdits.none, {
					gear: boat,
					realm: 'water'
				});
				const spot = nearestTent(PROTOTYPE, pos, TENT_SEARCH_STEPS, WorldEdits.none, boat)!;
				expect(rescue).toEqual({
					pos: spot.stand,
					facing: spot.facing,
					tent: spot.tent,
					party: partyOf(['squirrel'], ['otter'])
				});
				expect(isWalkable(tileAtWorld(PROTOTYPE, rescue.pos.x, rescue.pos.y).kind)).toBe(true);
				expect(canTalkToDoctor(PROTOTYPE, rescue.pos, rescue.facing)).toBe(true);
			}
		}
		expect(rescued).toBe(8);
	});

	it('out on the water, the battle is lost with animals that cannot swim still standing, never a swimmer', () => {
		const pos = spawnPoint(PROTOTYPE);
		const water = { realm: 'water' as const, gear: { boat: true } };
		expect(() =>
			takeToDoctor(PROTOTYPE, pos, partyOf(['bear'], ['frog', 0]), WorldEdits.none, water)
		).not.toThrow();
		expect(() =>
			takeToDoctor(PROTOTYPE, pos, partyOf(['bear', 0], ['frog', 3]), WorldEdits.none, water)
		).toThrow(/knocked out/);
		// On land a standing bear is someone to fight on, as ever.
		expect(() => takeToDoctor(PROTOTYPE, pos, partyOf(['bear'], ['frog', 0]))).toThrow(
			/knocked out/
		);
		// A realm that is neither is refused, never read as one where nobody can fight.
		for (const realm of ['sea', '', 7]) {
			const options = { realm: realm as unknown as Realm };
			expect(() =>
				takeToDoctor(PROTOTYPE, pos, partyOf(['bear']), WorldEdits.none, options)
			).toThrow(/realm/);
		}
	});

	it('walks the paths the player cleared: out of a spot walled in by trees, once they are chopped', () => {
		// A walkable tile walled in by trees and rocks, a tent within reach once they are cleared.
		let found: { pos: GridPos; edits: WorldEdits } | null = null;
		for (let y = -150; y < 150 && !found; y++)
			for (let x = -150; x < 150 && !found; x++) {
				if (!isWalkable(tileAtWorld(PROTOTYPE, x, y).kind)) continue;
				const around = (['up', 'down', 'left', 'right'] as Direction[]).map((d) =>
					step({ x, y }, d)
				);
				const kinds = around.map((n) => tileAtWorld(PROTOTYPE, n.x, n.y).kind);
				if (!kinds.every((k) => k === 'tree' || k === 'rock')) continue;
				const edits = around.reduce((e, n) => e.with(n), WorldEdits.none);
				if (nearestTent(PROTOTYPE, { x, y }, undefined, edits)) found = { pos: { x, y }, edits };
			}
		expect(found).not.toBeNull();
		const { pos, edits } = found!;
		const party = partyOf(['bear', 0]);
		// Without the overlay the trees still stand, and a doctor comes to the player.
		expect(takeToDoctor(PROTOTYPE, pos, party).tent).toBeNull();
		const rescue = takeToDoctor(PROTOTYPE, pos, party, edits);
		const spot = nearestTent(PROTOTYPE, pos, undefined, edits)!;
		expect(rescue).toEqual({
			pos: spot.stand,
			facing: spot.facing,
			tent: spot.tent,
			party: partyOf(['bear'])
		});
		expect(isWalkable(editedTileAt(PROTOTYPE, edits, rescue.pos.x, rescue.pos.y).kind)).toBe(true);
		expect(canTalkToDoctor(PROTOTYPE, rescue.pos, rescue.facing)).toBe(true);
	});

	it('only takes a party that is all knocked out, and a real one', () => {
		const pos = spawnPoint(PROTOTYPE);
		expect(() => takeToDoctor(PROTOTYPE, pos, partyOf(['squirrel', 0], ['fox', 1]))).toThrow(
			/knocked out/
		);
		expect(() => takeToDoctor(PROTOTYPE, pos, [])).toThrow(/empty/);
		expect(() => takeToDoctor(PROTOTYPE, pos, partyOf(['squirrel', -1]))).toThrow(/hp/);
		expect(() =>
			takeToDoctor(PROTOTYPE, pos, [
				{ id: 'twin', speciesId: 'fox', hp: 0 },
				{ id: 'twin', speciesId: 'fox', hp: 0 }
			])
		).toThrow(/share/);
		expect(() => takeToDoctor(PROTOTYPE, { x: NaN, y: 0 }, partyOf(['fox', 0]))).toThrow(
			/whole-number/
		);
	});
});
