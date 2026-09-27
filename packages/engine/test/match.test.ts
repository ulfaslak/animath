import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import { ATTACK_LEVELS, type AnimalInstance, type AttackLevel } from '../src/animals/types.js';
import { attackDamage } from '../src/battle/damage.js';
import { applyMatchIntent, canSendIn, otherSide, startMatch } from '../src/match/reducer.js';
import { MATCH_TEAM_SIZE, matchTeam } from '../src/match/team.js';
import type {
	MatchEvent,
	MatchIntent,
	MatchRejection,
	MatchSide,
	MatchState,
	MatchStep
} from '../src/match/types.js';
import { matchView, shownPuzzle } from '../src/match/view.js';
import { normalizeNickname } from '../src/party/names.js';
import { puzzleDifficulty } from '../src/puzzles/difficulty.js';
import { checkAnswer, getGenerator } from '../src/puzzles/registry.js';
import { Rng, hashInts } from '../src/rng.js';
import { mover, nextMatchIntent, party, playMatch, type MatchPlayer } from './match-sim.js';
import { wordedStrings } from './words.js';

const PRINT = Boolean(process.env.SIM);
const ALL = ANIMALS.map((a) => a.id);
const LAND = ALL.filter((id) => canFightIn(id, 'land'));
const SEA = ALL.filter((id) => !canFightIn(id, 'land'));
const NICKNAMES: readonly unknown[] = [
	'Nini',
	'  Pip  ',
	'Mr Whiskers the Great',
	'🦊',
	'',
	42,
	'Bjørn'
];

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
	}
	return value;
}

function maxHp(speciesId: string): number {
	return getAnimal(speciesId).maxHp;
}

/** Every path in `value` to a key named `answer`: where a puzzle's answer would be. */
function answerKeys(value: unknown, path = ''): string[] {
	if (Array.isArray(value)) return value.flatMap((v, i) => answerKeys(v, `${path}[${i}]`));
	if (value === null || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([key, v]) => [
		...(key === 'answer' ? [`${path}.${key}`] : []),
		...answerKeys(v, `${path}.${key}`)
	]);
}

/** The first seed from 0 up at which `side` starts. The coin reads only the seed. */
function seedWhere(side: MatchSide): number {
	for (let seed = 0; ; seed++) {
		const { phase } = startMatch({ a: party(['squirrel']), b: party(['squirrel']) }, seed);
		if (phase.kind === 'choose-action' && phase.side === side) return seed;
	}
}

/** Apply intents in order, each from the side named with it; throws on a refusal. */
function play(state: MatchState, seed: number, moves: [MatchSide, MatchIntent][]): MatchStep {
	let step: MatchStep = { state, events: [] };
	for (const [side, intent] of moves) {
		step = applyMatchIntent(step.state, side, intent, seed);
		const refused = step.events.find((e) => e.type === 'rejected');
		if (refused) throw new Error(`${side} ${JSON.stringify(intent)}: ${JSON.stringify(refused)}`);
	}
	return step;
}

/** The open puzzle's answer, as the kid would work it out. */
function solution(state: MatchState): string {
	if (state.phase.kind !== 'solving') throw new Error('no puzzle open');
	return String(state.phase.puzzle.answer);
}

// --- the team ---------------------------------------------------------------

describe('matchTeam', () => {
	it('brings the first three animals that can fight on land, in party order, tired ones too, at full HP', () => {
		const given = deepFreeze([
			{ id: 'c', speciesId: 'crab', hp: 3 },
			{ id: 's', speciesId: 'squirrel', hp: 0 },
			{ id: 'w', speciesId: 'whale', hp: 100 },
			{ id: 'f', speciesId: 'fox', hp: 5, nickname: 'Rusty' },
			{ id: 'b', speciesId: 'bear', hp: 1 },
			{ id: 'r', speciesId: 'rabbit', hp: 22 }
		]);
		expect(matchTeam(given)).toStrictEqual({
			ok: true,
			team: [
				{ id: 's', speciesId: 'squirrel', hp: maxHp('squirrel') },
				{ id: 'f', speciesId: 'fox', nickname: 'Rusty', hp: maxHp('fox') },
				{ id: 'b', speciesId: 'bear', hp: maxHp('bear') }
			]
		});
	});

	it('brings fewer when the party has fewer, and none when nobody in it can fight on land', () => {
		expect(matchTeam([{ id: 'o', speciesId: 'otter', hp: 0 }])).toStrictEqual({
			ok: true,
			team: [{ id: 'o', speciesId: 'otter', hp: maxHp('otter') }]
		});
		expect(matchTeam([])).toEqual({ ok: false, reason: 'no-team' });
		expect(matchTeam(party(SEA))).toEqual({ ok: false, reason: 'no-team' });
	});

	it('cleans a nickname as a rename does, and drops one that cleans to nothing', () => {
		for (const nickname of NICKNAMES) {
			const pick = matchTeam([{ id: 'x', speciesId: 'rabbit', hp: 1, nickname }]);
			if (!pick.ok) throw new Error('refused');
			const clean = normalizeNickname(nickname);
			const want: AnimalInstance =
				clean === undefined
					? { id: 'x', speciesId: 'rabbit', hp: maxHp('rabbit') }
					: { id: 'x', speciesId: 'rabbit', nickname: clean, hp: maxHp('rabbit') };
			expect(pick.team, String(nickname)).toStrictEqual([want]);
		}
	});

	it('drops a nickname holding a rude word, so the other kid never reads it: the animal goes by its kind', () => {
		// The other player sees these; a rude one is the only rude text that could cross
		// between two kids, since there is no chat. The rules are the names' (`isRude`),
		// with a nickname's full stops and apostrophes between words too.
		const rude = [
			'Fuckface',
			'F.u.c.k',
			'Big Shit',
			'B1tch',
			"Pik'hoved",
			'Lort',
			'Mr. Dick',
			'Fück'
		];
		const kept = ['Nini', 'Scunthorpe', 'Pikachu', 'Hassan', 'Mr. Whiskers', "O'Hara", 'Bjørn'];
		for (const nickname of rude) {
			const pick = matchTeam([{ id: 'x', speciesId: 'fox', hp: 1, nickname }]);
			expect(pick, nickname).toStrictEqual({
				ok: true,
				team: [{ id: 'x', speciesId: 'fox', hp: maxHp('fox') }]
			});
		}
		for (const nickname of kept) {
			const pick = matchTeam([{ id: 'x', speciesId: 'fox', hp: 1, nickname }]);
			expect(pick.ok && pick.team[0]!.nickname, nickname).toBe(normalizeNickname(nickname));
		}
		// Still idempotent: a team with its rude nickname dropped comes back the same.
		const once = matchTeam([{ id: 'x', speciesId: 'fox', hp: 1, nickname: 'Fuckface' }]);
		expect(once.ok && matchTeam(once.team)).toStrictEqual(once);
	});

	it('refuses anything that is not a party', () => {
		const rabbit = { id: 'r', speciesId: 'rabbit', hp: 3 };
		const notParties: unknown[] = [
			null,
			undefined,
			'rabbit',
			7,
			{ 0: rabbit, length: 1 },
			[null],
			[[]],
			['rabbit'],
			[{ ...rabbit, id: '' }],
			[{ ...rabbit, id: 'x'.repeat(65) }],
			[{ ...rabbit, id: 7 }],
			[{ ...rabbit, speciesId: 'dragon' }],
			[{ id: 'r', hp: 3 }],
			[rabbit, { ...rabbit, speciesId: 'fox' }],
			// A sea animal is looked at on the way, and counts.
			[
				{ id: 'c', speciesId: 'crab', hp: 1 },
				{ id: 'c', speciesId: 'fox', hp: 1 }
			]
		];
		for (const given of notParties) {
			expect(matchTeam(given), JSON.stringify(given)).toEqual({ ok: false, reason: 'not-a-party' });
		}
		expect(matchTeam([{ ...rabbit, id: 'x'.repeat(64) }]).ok).toBe(true);
	});

	it('looks at no entry once the team is full', () => {
		const pick = matchTeam([...party(['squirrel', 'crab', 'rabbit', 'frog']), null, 'junk']);
		expect(pick.ok && pick.team.map((a) => a.speciesId)).toEqual(['squirrel', 'rabbit', 'frog']);
	});

	it('cleans only its own team’s nicknames, so the text in entries it passes over costs nothing', () => {
		// The server calls it on whatever a client sent. With every entry's
		// nickname cleaned, 5,000 sea animals with 1,000-character accented
		// nicknames took 0.6 s; these 15,000 take a few milliseconds, checked for
		// shape only.
		const nickname = 'e\u0301'.repeat(500);
		const sent = Array.from({ length: 15_000 }, (_, i) => ({
			id: `c${i}`,
			speciesId: 'crab',
			hp: 1,
			nickname
		}));
		const party = [...sent, { id: 'f', speciesId: 'fox', hp: 1, nickname }];
		// The fastest of up to three tries: at a load average of 40 one try in a few took over
		// 250 ms while the machine was busy elsewhere (#86), and the first is also the coldest.
		let ms = Infinity;
		for (let i = 0; i < 3 && ms >= 250; i++) {
			const start = performance.now();
			const pick = matchTeam(party);
			ms = Math.min(ms, performance.now() - start);
			expect(pick.ok && pick.team[0]!.nickname).toBe(normalizeNickname(nickname));
		}
		expect(ms).toBeLessThan(250);
		// Milliseconds when the rule holds. When it breaks, each try cleans every nickname:
		// about 2 s alone, 5 s at a load average of 25.
	}, 30_000);

	it('over random parties: exactly the rule, idempotent, and the party untouched', () => {
		const bad: string[] = [];
		for (let seed = 0; seed < 400; seed++) {
			const rng = new Rng(hashInts(seed, 31));
			const given = Array.from({ length: rng.int(0, 8) }, (_, i) => {
				const speciesId = rng.pick(ALL);
				const animal: Record<string, unknown> = {
					id: `id-${i}`,
					speciesId,
					hp: rng.int(0, maxHp(speciesId))
				};
				if (rng.chance(0.4)) animal.nickname = rng.pick(NICKNAMES);
				return animal;
			});
			const before = JSON.stringify(given);
			deepFreeze(given);
			const want = given
				.filter((a) => canFightIn(a.speciesId as string, 'land'))
				.slice(0, MATCH_TEAM_SIZE)
				.map((a) => {
					const clean = normalizeNickname(a.nickname);
					const base = { id: a.id, speciesId: a.speciesId, hp: maxHp(a.speciesId as string) };
					return clean === undefined
						? base
						: { id: a.id, speciesId: a.speciesId, nickname: clean, hp: base.hp };
				});
			const pick = matchTeam(given);
			const expected = want.length ? { ok: true, team: want } : { ok: false, reason: 'no-team' };
			if (JSON.stringify(pick) !== JSON.stringify(expected))
				bad.push(`seed ${seed}: ${JSON.stringify(pick)}`);
			if (pick.ok && JSON.stringify(matchTeam(pick.team)) !== JSON.stringify(pick)) {
				bad.push(`seed ${seed}: not idempotent`);
			}
			if (JSON.stringify(given) !== before) bad.push(`seed ${seed}: the party changed`);
		}
		expect(bad).toEqual([]);
	});
});

// --- the start --------------------------------------------------------------

describe('startMatch', () => {
	it('prefixes every id with its side, so two old saves’ starters never share one', () => {
		const starter = [{ id: 'starter', speciesId: 'squirrel', hp: 0 }];
		const state = startMatch({ a: starter, b: starter }, 1);
		expect(state.teams.a.map((a) => a.id)).toEqual(['a:starter']);
		expect(state.teams.b.map((a) => a.id)).toEqual(['b:starter']);
		expect(state.teams.a[0]!.hp).toBe(maxHp('squirrel'));
	});

	it('starts on turn 1 with each first animal in front, and holds no seed', () => {
		const seed = 123456789;
		const state = startMatch({ a: party(['fox', 'deer']), b: party(['bear']) }, seed);
		expect(Object.keys(state)).toEqual(['step', 'turn', 'teams', 'active', 'phase']);
		expect(state.step).toBe(0);
		expect(state.turn).toBe(1);
		expect(state.active).toEqual({ a: 0, b: 0 });
		expect(state.phase.kind).toBe('choose-action');
		expect(JSON.stringify(state)).not.toMatch(/seed|123456789/);
	});

	it('flips a fair coin keyed by the seed alone: the same seed always, about half each over many', () => {
		let a = 0;
		const differ: number[] = [];
		for (let seed = 0; seed < 4000; seed++) {
			const first = startMatch({ a: party(['frog']), b: party(['wolf']) }, seed).phase;
			const again = startMatch({ a: party(['bear', 'fox']), b: party(['otter']) }, seed).phase;
			if (JSON.stringify(again) !== JSON.stringify(first)) differ.push(seed);
			if (first.kind === 'choose-action' && first.side === 'a') a++;
		}
		expect(differ).toEqual([]);
		expect(a / 4000).toBeGreaterThan(0.47);
		expect(a / 4000).toBeLessThan(0.53);
	});

	it('refuses a bad seed, and a side that brings no team', () => {
		const ok = party(['rabbit']);
		for (const seed of [-1, 1.5, 2 ** 32, Number.NaN]) {
			expect(() => startMatch({ a: ok, b: ok }, seed)).toThrow(/seed/);
		}
		expect(() => startMatch({ a: party(['crab']), b: ok }, 1)).toThrow(/side a brings no team/);
		expect(() => startMatch({ a: ok, b: [{ id: '', speciesId: 'fox', hp: 1 }] }, 1)).toThrow(
			/side b brings no team/
		);
	});

	it('never changes the parties it is given', () => {
		const a = deepFreeze([
			...party(['crab', 'bear']),
			{ id: 'n', speciesId: 'fox', hp: 0, nickname: ' Zip ' }
		]);
		const b = deepFreeze(party(['rabbit']));
		const before = JSON.stringify({ a, b });
		const state = startMatch({ a, b }, 5);
		expect(JSON.stringify({ a, b })).toBe(before);
		expect(state.teams.a[0]).not.toBe(a[1]);
	});
});

// --- one attack -------------------------------------------------------------

describe('an attack', () => {
	it('asks the puzzle a wild battle would, and hits for exactly the formula on a right answer, whatever is typed', () => {
		const bad: string[] = [];
		for (const species of LAND) {
			const spec = getAnimal(species);
			for (let n = 1; n <= spec.attacks.length; n++) {
				for (const level of ATTACK_LEVELS) {
					for (let seed = 0; seed < 6; seed++) {
						const start = deepFreeze(
							startMatch({ a: party([species]), b: party([species]) }, seed)
						);
						if (start.phase.kind !== 'choose-action') throw new Error('not started');
						const me = start.phase.side;
						const foe = otherSide(me);
						const asked = applyMatchIntent(
							start,
							me,
							{ type: 'attack', attackIndex: n, level },
							seed
						);
						const solving = deepFreeze(asked.state);
						if (solving.phase.kind !== 'solving') throw new Error('attack refused');
						const { puzzle } = solving.phase;
						expect(asked.events).toEqual([
							{ type: 'puzzle-shown', side: me, attackIndex: n, level, puzzle: shownPuzzle(puzzle) }
						]);
						const attack = spec.attacks[n - 1]!;
						const wanted = puzzleDifficulty(spec.tier, n, level);
						const supported = attack.kinds.some((k) => {
							const g = getGenerator(k);
							return wanted >= g.minDifficulty && wanted <= g.maxDifficulty;
						});
						if (!attack.kinds.includes(puzzle.kind))
							bad.push(`${species} ${n}/${level}: ${puzzle.kind}`);
						if (supported && puzzle.difficulty !== wanted) {
							bad.push(`${species} ${n}/${level}: difficulty ${puzzle.difficulty}, not ${wanted}`);
						}
						const a = puzzle.answer;
						const inputs = [
							'',
							' ',
							'x',
							`${a}.0`,
							`${a}x`,
							String(a + 1),
							String(a - 1),
							`-${a}`,
							String(a),
							` ${a} `,
							`+${a}`,
							`0${a}`
						];
						for (const input of inputs) {
							const { state, events } = applyMatchIntent(
								solving,
								me,
								{ type: 'answer', input },
								seed
							);
							const right = checkAnswer(puzzle, input);
							const hp = maxHp(species);
							const damage = attackDamage(spec, n, level, true);
							const left = Math.max(0, hp - damage);
							const want: MatchEvent[] = right
								? [
										{ type: 'answer-judged', side: me, correct: true },
										{ type: 'hit', attacker: me, attackIndex: n, level, damage, targetHp: left }
									]
								: [
										{ type: 'answer-judged', side: me, correct: false },
										{ type: 'missed', attacker: me, attackIndex: n, level }
									];
							if (right && left === 0) {
								want.push(
									{ type: 'fainted', side: foe, animal: { ...state.teams[foe][0]! } },
									{ type: 'ended', winner: me, reason: 'all-tired' }
								);
							}
							if (JSON.stringify(events) !== JSON.stringify(want)) {
								bad.push(`${species} ${n}/${level} "${input}": ${JSON.stringify(events)}`);
							}
							if (state.teams[foe][0]!.hp !== (right ? left : hp))
								bad.push(`${species} "${input}": HP`);
							if (state.teams[me] !== solving.teams[me])
								bad.push(`${species}: the attacker's team changed`);
						}
					}
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});

// --- turns ------------------------------------------------------------------

describe('turns', () => {
	it('an answer, right or wrong, and a switch pass the turn; an attack does not', () => {
		const seed = seedWhere('a');
		const s0 = startMatch({ a: party(['bear', 'wolf']), b: party(['bear', 'wolf']) }, seed);
		const asked = play(s0, seed, [['a', { type: 'attack', attackIndex: 1, level: 1 }]]).state;
		expect(asked.phase).toMatchObject({ kind: 'solving', side: 'a' });
		expect(asked.turn).toBe(1);

		const wrong = play(asked, seed, [['a', { type: 'answer', input: 'x' }]]).state;
		expect(wrong.phase).toEqual({ kind: 'choose-action', side: 'b' });
		expect(wrong.turn).toBe(2);
		expect(wrong.teams).toBe(asked.teams);

		const right = play(asked, seed, [['a', { type: 'answer', input: solution(asked) }]]).state;
		expect(right.phase).toEqual({ kind: 'choose-action', side: 'b' });
		expect(right.turn).toBe(2);

		const { state: switched, events } = play(s0, seed, [['a', { type: 'switch', teamIndex: 1 }]]);
		expect(events).toEqual([{ type: 'switched', side: 'a', animal: s0.teams.a[1], teamIndex: 1 }]);
		expect(switched.active).toEqual({ a: 1, b: 0 });
		expect(switched.phase).toEqual({ kind: 'choose-action', side: 'b' });
		expect(switched.turn).toBe(2);
		expect(switched.teams).toBe(s0.teams);
	});

	it('a knock-out: its side picks who steps in, for free, and then takes its turn', () => {
		const seed = seedWhere('a');
		// A bear's Crush on hard (67) knocks out a squirrel at full HP.
		const s0 = startMatch({ a: party(['bear']), b: party(['squirrel', 'rabbit', 'frog']) }, seed);
		const asked = play(s0, seed, [['a', { type: 'attack', attackIndex: 4, level: 3 }]]).state;
		const { state: out, events } = play(asked, seed, [
			['a', { type: 'answer', input: solution(asked) }]
		]);
		expect(events.map((e) => e.type)).toEqual(['answer-judged', 'hit', 'fainted']);
		expect(out.phase).toEqual({ kind: 'choose-animal', side: 'b' });
		expect(out.turn).toBe(2);
		expect(out.active.b).toBe(0);
		expect(out.teams.b[0]!.hp).toBe(0);

		expect(canSendIn(out, 'b', 0)).toBe(false);
		expect(canSendIn(out, 'b', 2)).toBe(true);
		expect(canSendIn(out, 'a', 0)).toBe(false);
		const picked = play(out, seed, [['b', { type: 'pick-next', teamIndex: 2 }]]);
		expect(picked.events).toEqual([
			{ type: 'switched', side: 'b', animal: out.teams.b[2], teamIndex: 2 }
		]);
		expect(picked.state.phase).toEqual({ kind: 'choose-action', side: 'b' });
		expect(picked.state.turn).toBe(2);
		expect(picked.state.active).toEqual({ a: 0, b: 2 });
		expect(picked.state.teams).toBe(out.teams);
	});

	it('the side with nobody standing loses, on the hit that tires its last animal', () => {
		const seed = seedWhere('b');
		const s0 = startMatch({ a: party(['squirrel']), b: party(['bear']) }, seed);
		const asked = play(s0, seed, [['b', { type: 'attack', attackIndex: 4, level: 3 }]]).state;
		const { state, events } = play(asked, seed, [
			['b', { type: 'answer', input: solution(asked) }]
		]);
		expect(events.slice(-2)).toEqual([
			{ type: 'fainted', side: 'a', animal: { ...state.teams.a[0]! } },
			{ type: 'ended', winner: 'b', reason: 'all-tired' }
		]);
		expect(state.phase).toEqual({ kind: 'ended', winner: 'b', reason: 'all-tired' });
		expect(state.turn).toBe(1);
	});

	it('leaving or timing out ends the match in every phase, from either side, and the other side wins', () => {
		const seed = seedWhere('a');
		const s0 = startMatch({ a: party(['bear']), b: party(['squirrel', 'rabbit']) }, seed);
		const solving = play(s0, seed, [['a', { type: 'attack', attackIndex: 4, level: 3 }]]).state;
		const picking = play(solving, seed, [
			['a', { type: 'answer', input: solution(solving) }]
		]).state;
		expect(picking.phase.kind).toBe('choose-animal');
		for (const state of [s0, solving, picking]) {
			for (const side of ['a', 'b'] as const) {
				for (const [type, reason] of [
					['leave', 'left'],
					['timeout', 'timed-out']
				] as const) {
					const step = applyMatchIntent(deepFreeze(state), side, { type }, seed);
					const winner = otherSide(side);
					expect(step.events).toEqual([{ type: 'ended', winner, reason }]);
					expect(step.state).toEqual({
						...state,
						step: state.step + 1,
						phase: { kind: 'ended', winner, reason }
					});
					for (const intent of [
						{ type: 'leave' },
						{ type: 'timeout' },
						{ type: 'answer', input: '1' }
					] as const) {
						const after = applyMatchIntent(step.state, winner, intent, seed);
						expect(after.state).toBe(step.state);
						expect(after.events).toEqual([{ type: 'rejected', reason: 'match-over' }]);
					}
				}
			}
		}
	});
});

// --- refusals ---------------------------------------------------------------

describe('rejected intents', () => {
	const seed = seedWhere('a');
	const s0 = deepFreeze(
		startMatch({ a: party(['bear', 'fox', 'deer']), b: party(['squirrel', 'rabbit']) }, seed)
	);
	// a's fox tired, to switch to.
	const tiredFox = deepFreeze({
		...s0,
		teams: { a: [s0.teams.a[0]!, { ...s0.teams.a[1]!, hp: 0 }, s0.teams.a[2]!], b: s0.teams.b }
	});
	const solving = deepFreeze(
		play(s0, seed, [['a', { type: 'attack', attackIndex: 4, level: 3 }]]).state
	);
	const picking = deepFreeze(
		play(solving, seed, [['a', { type: 'answer', input: solution(solving) }]]).state
	);

	const cases: [string, MatchState, MatchSide, unknown, MatchRejection][] = [
		['null', s0, 'a', null, 'not-an-intent'],
		['a string', s0, 'a', 'attack', 'not-an-intent'],
		['a list', s0, 'a', [], 'not-an-intent'],
		['no type', s0, 'a', {}, 'not-an-intent'],
		['a wild battle’s leash', s0, 'a', { type: 'throw-leash' }, 'not-an-intent'],
		['a wild battle’s flee', s0, 'a', { type: 'flee' }, 'not-an-intent'],
		['an answer without input', solving, 'a', { type: 'answer' }, 'not-an-intent'],
		['an answer that is a number', solving, 'a', { type: 'answer', input: 7 }, 'not-an-intent'],
		['garbage from the waiting side', s0, 'b', { type: 'dance' }, 'not-an-intent'],
		[
			'an attack from the waiting side',
			s0,
			'b',
			{ type: 'attack', attackIndex: 1, level: 1 },
			'not-your-turn'
		],
		['a switch from the waiting side', s0, 'b', { type: 'switch', teamIndex: 1 }, 'not-your-turn'],
		[
			'an answer from the waiting side',
			solving,
			'b',
			{ type: 'answer', input: '1' },
			'not-your-turn'
		],
		[
			'a pick from the waiting side',
			picking,
			'a',
			{ type: 'pick-next', teamIndex: 0 },
			'not-your-turn'
		],
		['an answer with no puzzle', s0, 'a', { type: 'answer', input: '1' }, 'no-puzzle'],
		['an answer while picking', picking, 'b', { type: 'answer', input: '1' }, 'no-puzzle'],
		['a pick with nothing to pick', s0, 'a', { type: 'pick-next', teamIndex: 1 }, 'not-picking'],
		['a pick mid-puzzle', solving, 'a', { type: 'pick-next', teamIndex: 1 }, 'not-picking'],
		[
			'an attack mid-puzzle',
			solving,
			'a',
			{ type: 'attack', attackIndex: 1, level: 1 },
			'not-choosing-an-action'
		],
		[
			'a switch mid-puzzle',
			solving,
			'a',
			{ type: 'switch', teamIndex: 1 },
			'not-choosing-an-action'
		],
		[
			'an attack while picking',
			picking,
			'b',
			{ type: 'attack', attackIndex: 1, level: 1 },
			'not-choosing-an-action'
		],
		[
			'a switch while picking',
			picking,
			'b',
			{ type: 'switch', teamIndex: 1 },
			'not-choosing-an-action'
		],
		['attack 0', s0, 'a', { type: 'attack', attackIndex: 0, level: 1 }, 'no-such-attack'],
		['attack 5 of 4', s0, 'a', { type: 'attack', attackIndex: 5, level: 1 }, 'no-such-attack'],
		['attack 1.5', s0, 'a', { type: 'attack', attackIndex: 1.5, level: 1 }, 'no-such-attack'],
		['attack "1"', s0, 'a', { type: 'attack', attackIndex: '1', level: 1 }, 'no-such-attack'],
		['level 0', s0, 'a', { type: 'attack', attackIndex: 1, level: 0 }, 'no-such-level'],
		['level 4', s0, 'a', { type: 'attack', attackIndex: 1, level: 4 }, 'no-such-level'],
		['level "2"', s0, 'a', { type: 'attack', attackIndex: 1, level: '2' }, 'no-such-level'],
		['no level', s0, 'a', { type: 'attack', attackIndex: 1 }, 'no-such-level'],
		['a switch to the one in front', s0, 'a', { type: 'switch', teamIndex: 0 }, 'already-in-front'],
		['a switch to nobody', s0, 'a', { type: 'switch', teamIndex: 3 }, 'no-such-animal'],
		['a switch to -1', s0, 'a', { type: 'switch', teamIndex: -1 }, 'no-such-animal'],
		['a switch to "1"', s0, 'a', { type: 'switch', teamIndex: '1' }, 'no-such-animal'],
		['a switch to a tired one', tiredFox, 'a', { type: 'switch', teamIndex: 1 }, 'tired'],
		[
			'a pick of the tired one in front',
			picking,
			'b',
			{ type: 'pick-next', teamIndex: 0 },
			'already-in-front'
		],
		['a pick of nobody', picking, 'b', { type: 'pick-next', teamIndex: 2 }, 'no-such-animal']
	];
	for (const [what, state, side, intent, reason] of cases) {
		it(`${what}: ${reason}, and the state untouched`, () => {
			const step = applyMatchIntent(state, side, intent as MatchIntent, seed);
			expect(step.events).toEqual([{ type: 'rejected', reason }]);
			expect(step.state).toBe(state);
		});
	}

	it('throws on a seed or a side the authority should never pass', () => {
		expect(() => applyMatchIntent(s0, 'a', { type: 'leave' }, -1)).toThrow(/seed/);
		expect(() => applyMatchIntent(s0, 'c' as MatchSide, { type: 'leave' }, seed)).toThrow(/side/);
		expect(() => matchView(s0, 'c' as MatchSide)).toThrow(/side/);
	});
});

// --- whole matches ----------------------------------------------------------

/** A random intent that must be refused in `state`, and why. */
function refusable(
	state: MatchState,
	rng: Rng
): { side: MatchSide; intent: unknown; reason: MatchRejection } {
	if (state.phase.kind === 'ended') {
		const intent = rng.pick<unknown>([
			{ type: 'leave' },
			{ type: 'timeout' },
			{ type: 'attack', attackIndex: 1, level: 1 }
		]);
		return { side: rng.pick(['a', 'b'] as const), intent, reason: 'match-over' };
	}
	const me = state.phase.side;
	const foe = otherSide(me);
	const active = state.active[me];
	const tired = state.teams[me].findIndex((a, i) => a.hp === 0 && i !== active);
	const garbage = {
		side: rng.pick(['a', 'b'] as const),
		intent: rng.pick<unknown>([null, 3, { type: 'flee' }, { type: 'answer', input: 4 }]),
		reason: 'not-an-intent' as const
	};
	const theirs = {
		side: foe,
		intent: rng.pick<unknown>([
			{ type: 'attack', attackIndex: 1, level: 1 },
			{ type: 'answer', input: '1' },
			{ type: 'switch', teamIndex: 0 },
			{ type: 'pick-next', teamIndex: 0 }
		]),
		reason: 'not-your-turn' as const
	};
	const mine: { intent: unknown; reason: MatchRejection }[] = [];
	switch (state.phase.kind) {
		case 'choose-action':
			mine.push(
				{ intent: { type: 'answer', input: '1' }, reason: 'no-puzzle' },
				{ intent: { type: 'pick-next', teamIndex: 0 }, reason: 'not-picking' },
				{ intent: { type: 'attack', attackIndex: 9, level: 1 }, reason: 'no-such-attack' },
				{ intent: { type: 'attack', attackIndex: 1, level: 7 }, reason: 'no-such-level' },
				{ intent: { type: 'switch', teamIndex: active }, reason: 'already-in-front' },
				{ intent: { type: 'switch', teamIndex: 9 }, reason: 'no-such-animal' }
			);
			if (tired >= 0) mine.push({ intent: { type: 'switch', teamIndex: tired }, reason: 'tired' });
			break;
		case 'solving':
			mine.push(
				{ intent: { type: 'attack', attackIndex: 1, level: 1 }, reason: 'not-choosing-an-action' },
				{ intent: { type: 'switch', teamIndex: 0 }, reason: 'not-choosing-an-action' },
				{ intent: { type: 'pick-next', teamIndex: 0 }, reason: 'not-picking' }
			);
			break;
		case 'choose-animal':
			mine.push(
				{ intent: { type: 'attack', attackIndex: 1, level: 1 }, reason: 'not-choosing-an-action' },
				{ intent: { type: 'answer', input: '1' }, reason: 'no-puzzle' },
				{ intent: { type: 'pick-next', teamIndex: active }, reason: 'already-in-front' },
				{ intent: { type: 'pick-next', teamIndex: -1 }, reason: 'no-such-animal' }
			);
			if (tired >= 0)
				mine.push({ intent: { type: 'pick-next', teamIndex: tired }, reason: 'tired' });
			break;
	}
	const pick = rng.int(0, mine.length + 1);
	if (pick === mine.length) return garbage;
	if (pick === mine.length + 1) return theirs;
	return { side: me, ...mine[pick]! };
}

describe('random matches', () => {
	it('every match ends; turns alternate; HP only falls, by hits; refusals change nothing; no view or event holds an answer; nothing is worded or mutated', () => {
		const bad: string[] = [];
		let more = 0;
		const note = (m: string) => (bad.length < 20 ? bad.push(m) : more++);
		const reasons = new Set<string>();
		const winners = new Set<string>();
		let switches = 0;
		let picks = 0;
		let solvingViews = 0;

		for (let m = 0; m < 250; m++) {
			const rng = new Rng(hashInts(m, 0x5eed));
			const seed = hashInts(m, 1);
			// Both parties start with an animal called `starter`, as old saves do.
			const randomParty = () => {
				const n = rng.int(1, 6);
				const p = Array.from({ length: n }, (_, i) => {
					const speciesId = rng.pick(ALL);
					return { id: i === 0 ? 'starter' : `n${i}`, speciesId, hp: rng.int(0, maxHp(speciesId)) };
				});
				if (!p.some((a) => canFightIn(a.speciesId, 'land')))
					p.push({ id: 'walker', speciesId: rng.pick(LAND), hp: 0 });
				return deepFreeze(p);
			};
			const parties = { a: randomParty(), b: randomParty() };
			const players: Record<MatchSide, MatchPlayer> = {
				a: { accuracy: 0.2 + 0.8 * rng.next(), policy: 'random', switch: rng.pick([0, 0.1, 0.4]) },
				b: { accuracy: 0.2 + 0.8 * rng.next(), policy: 'random', switch: rng.pick([0, 0.1, 0.4]) }
			};
			const before = JSON.stringify(parties);
			let state = startMatch(parties, seed);
			if (state.phase.kind !== 'choose-action') throw new Error('not started');
			const first = state.phase.side;
			const ids = [...state.teams.a, ...state.teams.b].map((a) => a.id);
			if (new Set(ids).size !== ids.length) note(`match ${m}: ids repeat ${ids}`);
			const totalHp = [...state.teams.a, ...state.teams.b].reduce((s, a) => s + a.hp, 0);
			let hits = 0;

			for (let i = 0; i < 3000 && state.phase.kind !== 'ended'; i++) {
				deepFreeze(state);

				// Views: no answer, not even one the view could be told apart by.
				for (const side of ['a', 'b'] as const) {
					const view = matchView(state, side);
					if (answerKeys(view).length) note(`match ${m} step ${i}: ${answerKeys(view)}`);
					if (wordedStrings(view).length) note(`match ${m}: worded ${wordedStrings(view)}`);
					if (state.phase.kind === 'solving') {
						solvingViews++;
						const puzzle = { ...state.phase.puzzle, answer: state.phase.puzzle.answer + 7919 };
						const twin = { ...state, phase: { ...state.phase, puzzle } };
						if (JSON.stringify(matchView(twin, side)) !== JSON.stringify(view)) {
							note(`match ${m} step ${i}: the view depends on the answer`);
						}
					}
					// canSendIn says exactly what the reducer takes, from a state or a view.
					for (let t = -1; t <= 3; t++) {
						const kind = state.phase.kind === 'choose-animal' ? 'pick-next' : 'switch';
						const taken = !applyMatchIntent(
							state,
							side,
							{ type: kind, teamIndex: t },
							seed
						).events.some((e) => e.type === 'rejected');
						if (canSendIn(state, side, t) !== taken || canSendIn(view, side, t) !== taken) {
							note(`match ${m} step ${i}: canSendIn(${side}, ${t}) disagrees`);
						}
					}
				}

				// A refused intent changes nothing.
				const wrong = refusable(state, rng);
				const refused = applyMatchIntent(state, wrong.side, wrong.intent as MatchIntent, seed);
				if (
					refused.state !== state ||
					JSON.stringify(refused.events) !==
						JSON.stringify([{ type: 'rejected', reason: wrong.reason }])
				) {
					note(
						`match ${m} step ${i}: ${JSON.stringify(wrong)} gave ${JSON.stringify(refused.events)}`
					);
				}

				// The move: now and then someone leaves, or the server reports one gone.
				const roll = rng.next();
				const move =
					roll < 0.002
						? { side: rng.pick(['a', 'b'] as const), intent: { type: 'leave' } as const }
						: roll < 0.004
							? { side: rng.pick(['a', 'b'] as const), intent: { type: 'timeout' } as const }
							: nextMatchIntent(state, players[mover(state)!], rng)!;
				const step = applyMatchIntent(state, move.side, move.intent, seed);
				const next = step.state;
				const said = step.events;
				const where = `match ${m} step ${i} ${move.side} ${JSON.stringify(move.intent)}`;

				if (said.some((e) => e.type === 'rejected'))
					note(`${where}: refused ${JSON.stringify(said)}`);
				if (next.step !== state.step + 1) note(`${where}: step`);
				if (answerKeys(said).length) note(`${where}: an event holds an answer`);
				if (wordedStrings(said).length) note(`${where}: worded ${wordedStrings(said)}`);

				// Turns alternate: the side that started plays the odd turns.
				const ended = next.phase.kind === 'ended';
				const passes = !ended && (move.intent.type === 'answer' || move.intent.type === 'switch');
				if (next.turn !== state.turn + (passes ? 1 : 0))
					note(`${where}: turn ${state.turn} → ${next.turn}`);
				if (next.phase.kind !== 'ended') {
					const due = next.turn % 2 === 1 ? first : otherSide(first);
					if (next.phase.side !== due)
						note(`${where}: ${next.phase.side} moves on turn ${next.turn}`);
				}

				// HP only falls, only for the animal in front of the side attacked, only by a hit.
				const hit = said.find((e) => e.type === 'hit');
				if (hit) hits++;
				for (const side of ['a', 'b'] as const) {
					next.teams[side].forEach((animal, t) => {
						const was = state.teams[side][t]!;
						const cap = maxHp(animal.speciesId);
						if (
							animal.id !== was.id ||
							animal.speciesId !== was.speciesId ||
							animal.nickname !== was.nickname
						) {
							note(`${where}: ${side}${t} became another animal`);
						}
						if (!Number.isInteger(animal.hp) || animal.hp < 0 || animal.hp > cap)
							note(`${where}: hp ${animal.hp}`);
						if (animal.hp === was.hp) return;
						const struck = hit && hit.attacker !== side && t === state.active[side];
						if (
							!struck ||
							animal.hp !== Math.max(0, was.hp - hit.damage) ||
							hit.targetHp !== animal.hp
						) {
							note(`${where}: ${side}${t} hp ${was.hp} → ${animal.hp}`);
						}
					});
					if (next.active[side] !== state.active[side]) {
						const e = said.find((x) => x.type === 'switched');
						if (
							!e ||
							e.type !== 'switched' ||
							e.side !== side ||
							e.teamIndex !== next.active[side]
						) {
							note(`${where}: ${side}'s animal in front changed unannounced`);
						}
						if (next.teams[side][next.active[side]]!.hp === 0)
							note(`${where}: a tired animal stepped in`);
						if (move.intent.type === 'switch') switches++;
						else picks++;
					}
				}

				// An end is announced, last, and it is right.
				const last = said[said.length - 1];
				if (ended !== (last?.type === 'ended')) note(`${where}: the end is not the last event`);
				if (next.phase.kind === 'ended') {
					const { winner, reason } = next.phase;
					if (last?.type !== 'ended' || last.winner !== winner || last.reason !== reason)
						note(`${where}: ended wrong`);
					if (reason === 'all-tired' && next.teams[otherSide(winner)].some((a) => a.hp > 0)) {
						note(`${where}: ${otherSide(winner)} lost with someone standing`);
					}
					if (
						reason !== 'all-tired' &&
						(winner === move.side || move.intent.type !== (reason === 'left' ? 'leave' : 'timeout'))
					) {
						note(`${where}: ${reason} won by ${winner}`);
					}
					reasons.add(reason);
					winners.add(winner);
				}
				state = next;
			}

			if (state.phase.kind !== 'ended') note(`match ${m}: never ended`);
			if (hits > totalHp) note(`match ${m}: ${hits} hits on ${totalHp} HP`);
			if (JSON.stringify(parties) !== before) note(`match ${m}: the parties changed`);
		}
		expect(bad).toEqual([]);
		expect(more).toBe(0);
		expect([...reasons].sort()).toEqual(['all-tired', 'left', 'timed-out']);
		expect([...winners].sort()).toEqual(['a', 'b']);
		expect(switches).toBeGreaterThan(200);
		expect(picks).toBeGreaterThan(200);
		expect(solvingViews).toBeGreaterThan(2000);
		// 250 whole matches, about 30 steps each, every step with two views, a
		// twin view, ten canSendIn probes and a refused intent: 0.3 s on a quiet
		// machine, 1.1 s alone at a load of 31, and 7 s inside the whole suite
		// at 34 (2026-09-27).
	}, 30_000);

	it('a side that only ever switches never stalls a match against a side that attacks', () => {
		for (let seed = 0; seed < 40; seed++) {
			const { state } = playMatch(
				seed,
				{ a: party(['squirrel', 'rabbit', 'frog']), b: party(['fox', 'rabbit', 'squirrel']) },
				{
					a: { accuracy: 0.5, policy: 'random', switch: 1 },
					b: { accuracy: 0.5, policy: 'random' }
				}
			);
			expect(state.phase.kind, `seed ${seed}`).toBe('ended');
		}
	});

	it('two sides that only switch play on until one leaves: the rules have no draw', () => {
		const seed = seedWhere('a');
		let state = startMatch({ a: party(['fox', 'deer']), b: party(['wolf', 'bear']) }, seed);
		for (let i = 0; i < 500; i++) {
			const side = mover(state)!;
			state = play(state, seed, [
				[side, { type: 'switch', teamIndex: 1 - state.active[side] }]
			]).state;
		}
		expect(state.phase.kind).toBe('choose-action');
		expect(state.turn).toBe(501);
		const left = play(state, seed, [['b', { type: 'leave' }]]).state;
		expect(left.phase).toEqual({ kind: 'ended', winner: 'a', reason: 'left' });
	});
});

// --- replay -----------------------------------------------------------------

describe('replay', () => {
	const players: Record<MatchSide, MatchPlayer> = {
		a: { accuracy: 0.7, policy: 'random', switch: 0.2 },
		b: { accuracy: 0.6, policy: 'random', switch: 0.1 }
	};
	const parties = { a: party(['frog', 'fox', 'bear']), b: party(['deer', 'wolf', 'rabbit']) };

	it('the same seed, parties and intents replay to the same states and events', () => {
		for (let seed = 0; seed < 25; seed++) {
			const seen: string[] = [];
			const run = playMatch(seed, parties, players, (_, side, intent, step) =>
				seen.push(JSON.stringify({ side, intent, step }))
			);
			let state = startMatch(parties, seed);
			const again: string[] = [];
			for (const { side, intent } of run.log) {
				const step = applyMatchIntent(state, side, intent, seed);
				again.push(JSON.stringify({ side, intent, step }));
				state = step.state;
			}
			expect(again).toEqual(seen);
			expect(state).toEqual(run.state);
		}
	});

	it('another seed asks other puzzles', () => {
		const prompts = (seed: number) =>
			playMatch(seed, parties, players)
				.events.flatMap((e) => (e.type === 'puzzle-shown' ? [e.puzzle.prompt] : []))
				.join(' | ');
		expect(prompts(1)).not.toBe(prompts(2));
	});

	it('golden: frog, fox and bear against deer, wolf and rabbit, seed 2026', () => {
		// Pins the coin's key, the Rng per step and the attack's puzzle: a server
		// replaying a logged match must meet these exact puzzles.
		const run = playMatch(2026, parties, players);
		const shown = run.events.filter((e) => e.type === 'puzzle-shown');
		expect({
			first: run.log[0]!.side,
			intents: run.log.length,
			puzzles: shown.length,
			firstPuzzles: shown.slice(0, 3).map((e) => e.puzzle.prompt),
			end: run.state.phase,
			turn: run.state.turn
		}).toEqual({
			first: 'b',
			intents: 42,
			puzzles: 18,
			firstPuzzles: ['330 ÷ 15 = ?', '18 − 9 = ?', '19 × 8 = ?'],
			end: { kind: 'ended', winner: 'a', reason: 'all-tired' },
			turn: 20
		});
	});
});

// --- transcripts ------------------------------------------------------------

describe('transcripts', () => {
	it.runIf(PRINT)('prints three matches as text', () => {
		const name = (a: AnimalInstance) => a.nickname ?? a.speciesId;
		const show = (
			title: string,
			seed: number,
			a: string[],
			b: string[],
			pa: MatchPlayer,
			pb: MatchPlayer
		) => {
			const lines: string[] = [`### ${title} (seed ${seed})`];
			playMatch(
				seed,
				{ a: party(a), b: party(b) },
				{ a: pa, b: pb },
				(before, side, intent, step) => {
					const me = before.teams[side][before.active[side]]!;
					const head = `t${String(before.turn).padStart(2)} ${side} ${name(me).padEnd(8)}`;
					for (const e of step.events) {
						switch (e.type) {
							case 'puzzle-shown': {
								const attack = getAnimal(me.speciesId).attacks[e.attackIndex - 1]!.id;
								lines.push(
									`${head} ${attack} (${['easy', 'medium', 'hard'][e.level - 1]}): ${e.puzzle.prompt}   [d${e.puzzle.difficulty}]`
								);
								break;
							}
							case 'answer-judged':
								lines.push(
									`${head}   answers ${JSON.stringify(intent.type === 'answer' ? intent.input : '')}: ${e.correct ? 'right' : 'wrong'}`
								);
								break;
							case 'hit':
								lines.push(`${head}   hits for ${e.damage}, ${e.targetHp} HP left`);
								break;
							case 'missed':
								lines.push(`${head}   misses`);
								break;
							case 'fainted':
								lines.push(`${head}   ${e.side}'s ${name(e.animal)} is tired`);
								break;
							case 'switched':
								lines.push(`${head}   ${e.side} sends in ${name(e.animal)}`);
								break;
							case 'ended':
								lines.push(`${head}   ${e.winner} wins (${e.reason})`);
								break;
							default:
								lines.push(`${head}   ${JSON.stringify(e)}`);
						}
					}
				}
			);
			console.log(`\n${lines.join('\n')}\n`);
		};
		show(
			'Two tier-1 teams, both right 7 in 10',
			3,
			['squirrel', 'rabbit', 'frog'],
			['rabbit', 'frog', 'squirrel'],
			{ accuracy: 0.7, policy: 'random' },
			{ accuracy: 0.7, policy: 'random' }
		);
		show(
			'Fox, otter, fox against deer, deer, deer, both right 9 in 10',
			8,
			['fox', 'otter', 'fox'],
			['deer', 'deer', 'deer'],
			{ accuracy: 0.9, policy: 'random' },
			{ accuracy: 0.9, policy: 'random' }
		);
		show(
			'Bear, squirrel against wolf, frog, 6 in 10, switching now and then',
			21,
			['bear', 'squirrel'],
			['wolf', 'frog'],
			{ accuracy: 0.6, policy: 'random', switch: 0.2 },
			{ accuracy: 0.6, policy: 'max', switch: 0.2 }
		);
	});
});
