import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance } from '../src/animals/types.js';
import { takeToDoctor } from '../src/doctor/knockout.js';
import { needsHealing } from '../src/doctor/party.js';
import { applyDoctorIntent, startDoctorVisit } from '../src/doctor/reducer.js';
import type { DoctorEvent, DoctorIntent, DoctorState, DoctorStep } from '../src/doctor/types.js';
import { healingDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer } from '../src/puzzles/registry.js';
import { Rng, hashInts, hashString } from '../src/rng.js';
import { spawnPoint, tileAtWorld } from '../src/world/generate.js';
import { canTalkToDoctor, nearestTent } from '../src/world/tents.js';
import { isWalkable, step, type Direction, type GridPos } from '../src/world/types.js';
import { makeParty, makeWild, playBattle } from './battle-sim.js';

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

/** Apply an intent to a frozen state and check what every accepted doctor step must keep. */
function apply(state: DoctorState, intent: DoctorIntent, seed: number): DoctorStep {
	const step = applyDoctorIntent(deepFreeze(state), intent, seed);
	if (step.events[0]?.type === 'rejected') {
		expect(step.state).toBe(state);
		expect(step.events).toHaveLength(1);
		return step;
	}
	expect(step.state.step).toBe(state.step + 1);
	expect(step.state).not.toHaveProperty('seed');
	expect(step.state.party).toHaveLength(state.party.length);
	for (const [i, after] of step.state.party.entries()) {
		const before = state.party[i]!;
		expect(after.id).toBe(before.id);
		expect(after.hp).toBeGreaterThanOrEqual(before.hp);
		expect(after.hp).toBeLessThanOrEqual(maxHp(after));
		const healed = step.events.some((e) => e.type === 'healed' && e.partyIndex === i);
		expect(after.hp, `animal ${i} changed without a healed event`).toBe(
			healed ? maxHp(after) : before.hp
		);
	}
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
	it('copies the party and greets by whether anyone is hurt', () => {
		const party = partyOf(['squirrel', 0], ['fox']);
		const state = startDoctorVisit(party);
		expect(state).toEqual({
			step: 0,
			party,
			phase: { kind: 'choose-patient' },
			log: ['Hello! Who needs help today?']
		});
		expect(state.party[0]).not.toBe(party[0]);

		for (const healthy of [partyOf(['squirrel'], ['bear']), []]) {
			expect(startDoctorVisit(healthy).log).toEqual(['Hello! Your animals are all fit and happy.']);
		}
	});

	it('carries no seed: nothing in the state lets a client predict a puzzle', () => {
		expect(Object.keys(startDoctorVisit(partyOf(['fox', 3]))).sort()).toEqual([
			'log',
			'party',
			'phase',
			'step'
		]);
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
			expect(step.events).toEqual([{ type: 'rejected', reason: 'That is not an intent.' }]);
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
		expect(rejected(start, { type: 'pick-patient', partyIndex: 1 })).toBe(
			'Rabbit is already fit and happy.'
		);
		for (const partyIndex of [
			-1,
			2,
			0.5,
			NaN,
			'0' as unknown as number,
			undefined as unknown as number
		])
			expect(rejected(start, { type: 'pick-patient', partyIndex })).toBe(
				'There is no animal there.'
			);
		expect(rejected(start, { type: 'answer', input: '4' })).toBe('There is no puzzle to answer.');
		rejected(start, { type: 'heal-everyone' } as unknown as DoctorIntent);

		const puzzle = applyDoctorIntent(start, { type: 'pick-patient', partyIndex: 0 }, 9).state;
		expect(rejected(puzzle, { type: 'pick-patient', partyIndex: 1 })).toBe(
			'Rabbit is already fit and happy.'
		);

		const ended = applyDoctorIntent(puzzle, { type: 'leave' }, 9).state;
		for (const intent of [
			{ type: 'pick-patient', partyIndex: 0 },
			{ type: 'answer', input: String(solving(puzzle).puzzle.answer) },
			{ type: 'leave' }
		] as DoctorIntent[])
			expect(rejected(ended, intent)).toBe('The visit is over.');
	});
});

describe('healing, for every species', () => {
	for (const spec of ANIMALS) {
		it(`${spec.name}: a puzzle at its healing difficulty; a wrong answer changes nothing; a right one heals it to full`, () => {
			const kinds = new Set(spec.attacks.flatMap((a) => a.kinds));
			for (const hp of [0, 1, spec.maxHp - 1]) {
				for (let seed = 0; seed < SEEDS; seed++) {
					let state = startDoctorVisit(partyOf([spec.id, hp], ['fox', 7], ['rabbit']));
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
		});
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

	it('heals one animal per right answer, and only the one picked', () => {
		let state = startDoctorVisit(partyOf(['squirrel', 0], ['bear', 30], ['otter', 0], ['deer']));
		const seed = 5;
		for (const partyIndex of [2, 0, 1]) {
			const before = state.party.map((a) => a.hp);
			state = apply(state, { type: 'pick-patient', partyIndex }, seed).state;
			state = apply(
				state,
				{ type: 'answer', input: String(solving(state).puzzle.answer) },
				seed
			).state;
			const after = state.party.map((a) => a.hp);
			expect(after.filter((hp, i) => hp !== before[i])).toHaveLength(1);
			expect(after[partyIndex]).toBe(maxHp(state.party[partyIndex]!));
		}
		expect(state.party.every((a) => !needsHealing(a))).toBe(true);
		expect(state.log.slice(-4)).toEqual([
			'Who is next?',
			"Let's help Bear! Can you solve this?",
			'Well done! Bear feels all better!',
			'Everyone is fit and happy!'
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
			expect(s.state.log.at(-1)).toBe('Bye! Come back any time.');
		}
	});
});

/** A kid at the doctor: right with probability `accuracy`, picks hurt animals at random, sometimes walks off. */
function playVisit(seed: number, party: AnimalInstance[], accuracy: number) {
	const rng = new Rng(hashInts(seed, 0xd0c));
	let state = startDoctorVisit(party);
	const events: DoctorEvent[] = [];
	const intents: DoctorIntent[] = [];
	for (let i = 0; i < 400 && state.phase.kind !== 'ended'; i++) {
		let intent: DoctorIntent;
		if (state.phase.kind === 'solving') {
			const a = state.phase.puzzle.answer;
			intent = { type: 'answer', input: String(rng.chance(accuracy) ? a : a + 1) };
		} else {
			const hurt = [...state.party.keys()].filter((j) => needsHealing(state.party[j]!));
			intent =
				hurt.length === 0 || rng.chance(0.03)
					? { type: 'leave' }
					: { type: 'pick-patient', partyIndex: rng.pick(hurt) };
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
		for (const [i, a] of ids.entries()) {
			const party = partyOf([a, 0], [ids[(i + 3) % ids.length]!, 1], ['squirrel', 5]);
			for (let seed = 0; seed < 5; seed++) {
				const first = playVisit(seed, party, 0.6);
				const again = playVisit(seed, party, 0.6);
				expect(again).toEqual(first);
				expect(first.state.phase.kind).toBe('ended');
			}
		}
	});

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
			{ type: 'rejected', reason: 'Rabbit is already fit and happy.' },
			{
				type: 'healed',
				partyIndex: 0,
				animal: { id: 'squirrel-0', speciesId: 'squirrel', hp: 20 }
			},
			{ type: 'rejected', reason: 'Squirrel is already fit and happy.' },
			{ type: 'healed', partyIndex: 1, animal: { id: 'fox-1', speciesId: 'fox', hp: 35 } },
			{ type: 'rejected', reason: 'The visit is over.' }
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
			phase: { kind: 'ended' },
			log: [
				'Hello! Who needs help today?',
				"Let's help Squirrel! Can you solve this?",
				"Not quite! Let's try another one.",
				'Well done! Squirrel feels all better!',
				'Who is next?',
				"Let's help Fox! Can you solve this?",
				"Not quite! Let's try another one.",
				"Not quite! Let's try another one.",
				'Well done! Fox feels all better!',
				'Everyone is fit and happy!',
				'Bye! Come back any time.'
			]
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
					],
					message: 'The doctor looked after your animals. Everyone feels better!'
				});
				expect(isWalkable(tileAtWorld(seed, rescue.pos.x, rescue.pos.y).kind)).toBe(true);
				expect(step(rescue.pos, rescue.facing)).toEqual(rescue.tent);
				expect(canTalkToDoctor(seed, rescue.pos, rescue.facing)).toBe(true);
				expect(takeToDoctor(seed, pos, party)).toEqual(rescue);
			}
		}
	});

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
			party: partyOf(['bear']),
			message: 'A doctor came by and looked after your animals. Everyone feels better!'
		});
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
