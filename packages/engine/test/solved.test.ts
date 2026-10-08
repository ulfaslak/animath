import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleEvent, BattleIntent } from '../src/battle/types.js';
import { needsHealing } from '../src/doctor/party.js';
import { applyDoctorIntent, startDoctorVisit } from '../src/doctor/reducer.js';
import type { DoctorEvent, DoctorIntent } from '../src/doctor/types.js';
import { ITEM_IDS } from '../src/items/catalog.js';
import { applyMatchIntent, startMatch } from '../src/match/reducer.js';
import type { MatchEvent, MatchIntent, MatchSide } from '../src/match/types.js';
import { answerForm, answerText } from '../src/puzzles/registry.js';
import { countSolved } from '../src/puzzles/solved.js';
import type { Puzzle } from '../src/puzzles/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { arena, makeParty, makeWild, nextIntent } from './battle-sim.js';
import { nextMatchIntent, party as matchParty } from './match-sim.js';

/**
 * The count of puzzles solved ([[PRODUCT]] §4 "Puzzles"): every right answer
 * adds exactly one, wherever it is judged (a wild battle, a heal, a token
 * sum, a friendly match), a wrong one adds none, and nothing else moves it.
 * The kid here decides right or wrong before answering and types the answer
 * in forms `checkAnswer` takes or refuses, so the test knows what should
 * count without asking the code it checks.
 */

/**
 * Ways a kid types the right answer to `puzzle`: as it is, with spaces round it, with a plus;
 * a clock's time as "3:15", with spaces round it, or "3.15".
 */
function rightInputs(puzzle: Pick<Puzzle, 'kind' | 'answer'>): string[] {
	const n = puzzle.answer;
	if (answerForm(puzzle.kind) === 'time') {
		const text = answerText(puzzle as Puzzle);
		return [text, ` ${text} `, text.replace(':', '.')];
	}
	return [String(n), ` ${n} `, `+${n}`];
}

/** Ways a kid types a wrong answer: one off, nothing, a fraction, letters; on a clock, a minute off. */
function wrongInputs(puzzle: Pick<Puzzle, 'kind' | 'answer'>): string[] {
	const n = puzzle.answer;
	if (answerForm(puzzle.kind) === 'time') {
		const later = answerText({ ...(puzzle as Puzzle), answer: n + 1 });
		return [later, '', `${later}.5`, 'abc', '25:00'];
	}
	return [String(n + 1), String(n - 1), '', `${n}.5`, 'abc', `${n}${n}0`];
}

/** An answer the kid meant right or wrong, and whether it was right. */
function typed(
	rng: Rng,
	puzzle: Pick<Puzzle, 'kind' | 'answer'>,
	accuracy: number
): { input: string; right: boolean } {
	const right = rng.chance(accuracy);
	return { input: rng.pick(right ? rightInputs(puzzle) : wrongInputs(puzzle)), right };
}

/** The first few failures of a sweep and how many there were, so a broken rule fails fast. */
function findings(bad: string[]): string[] {
	return bad.length > 20 ? [...bad.slice(0, 20), `…and ${bad.length - 20} more`] : bad;
}

describe('countSolved', () => {
	it('adds one for each right answer and none for a wrong one; other events change nothing', () => {
		const right: BattleEvent = { type: 'answer-judged', input: '12', correct: true, answer: 12 };
		const wrong: BattleEvent = { type: 'answer-judged', input: '13', correct: false, answer: 12 };
		const miss: BattleEvent = { type: 'missed', attacker: 'player', attackIndex: 1, level: 1 };
		expect(countSolved(0, [])).toBe(0);
		expect(countSolved(7, [right])).toBe(8);
		expect(countSolved(7, [wrong, miss])).toBe(7);
		expect(countSolved(7, [right, wrong, right])).toBe(9);
		const healed: DoctorEvent = { type: 'answer-judged', input: '4', correct: true, answer: 4 };
		expect(countSolved(312, [healed])).toBe(313);
	});

	it('in a match, counts only the answers of the side it is asked for', () => {
		const events: MatchEvent[] = [
			{ type: 'answer-judged', side: 'a', correct: true },
			{ type: 'answer-judged', side: 'b', correct: true },
			{ type: 'answer-judged', side: 'b', correct: true },
			{ type: 'answer-judged', side: 'a', correct: false }
		];
		expect(countSolved(0, events, 'a')).toBe(1);
		expect(countSolved(0, events, 'b')).toBe(2);
	});

	it('never goes past the most a save holds', () => {
		const right: BattleEvent = { type: 'answer-judged', input: '1', correct: true, answer: 1 };
		const max = Number.MAX_SAFE_INTEGER;
		expect(countSolved(max, [right])).toBe(max);
		expect(countSolved(max - 1, [right, right])).toBe(max);
		expect(Number.isSafeInteger(countSolved(max, [right, right, right]))).toBe(true);
	});

	it('in wild battles of every species against every other, each right answer adds one and nothing else does', () => {
		const ids = ANIMALS.map((a) => a.id);
		const bad: string[] = [];
		let right = 0;
		let wrong = 0;
		for (const lead of ids) {
			for (const wildId of ids) {
				const realm = arena(lead, wildId);
				if (realm === null) continue;
				for (let seed = 0; seed < 2; seed++) {
					const rng = new Rng(hashInts(seed, 0x5017ed, ids.indexOf(lead), ids.indexOf(wildId)));
					let state = startBattle(makeParty([lead, lead]), makeWild(wildId), { realm });
					let solved = seed * 5;
					for (let i = 0; i < 2000 && state.phase.kind !== 'ended'; i++) {
						let intent: BattleIntent;
						let meant = false;
						if (state.phase.kind === 'solving') {
							const answer = typed(rng, state.phase.puzzle, 0.6);
							intent = { type: 'answer', input: answer.input };
							meant = answer.right;
							if (meant) right++;
							else wrong++;
						} else if (rng.chance(0.05)) {
							// An answer with no puzzle open: refused, and nothing counts.
							intent = { type: 'answer', input: '1' };
						} else {
							intent = nextIntent(
								state,
								{ accuracy: 0, policy: 'random', leash: 0.05, flee: 0.01, switch: 0.1 },
								rng
							)!;
						}
						const step = applyBattleIntent(state, intent, seed);
						const after = countSolved(solved, step.events);
						if (after !== solved + (meant ? 1 : 0)) {
							bad.push(
								`${lead} v ${wildId} seed ${seed}: ${JSON.stringify(intent)} ${solved} → ${after}`
							);
						}
						solved = after;
						state = step.state;
					}
				}
			}
		}
		expect(findings(bad)).toEqual([]);
		// The sweep answered plenty both ways.
		expect(right).toBeGreaterThan(500);
		expect(wrong).toBeGreaterThan(300);
	});

	it('at the doctor, a right heal, hand-over or purchase adds one; a miss, backing out or leaving adds none', () => {
		const ids = ANIMALS.map((a) => a.id);
		const bad: string[] = [];
		const counted = new Map<string, number>();
		for (let seed = 0; seed < 40; seed++) {
			const rng = new Rng(hashInts(seed, 0xd0c7));
			const team: AnimalInstance[] = [0, 1, 2, 3, 4].map((i) => {
				const speciesId = ids[(seed + i * 3) % ids.length]!;
				const max = getAnimal(speciesId).maxHp;
				return { id: `p${i}`, speciesId, hp: rng.int(0, max) };
			});
			// Always one walker standing, so hand-overs can go through.
			team.push({ id: 'walker', speciesId: 'fox', hp: getAnimal('fox').maxHp });
			let state = startDoctorVisit(team, { tokens: rng.int(0, 60), items: [], shop: ITEM_IDS });
			let solved = 3;
			for (let i = 0; i < 300 && state.phase.kind !== 'ended'; i++) {
				const phase = state.phase;
				let intent: DoctorIntent;
				let meant = false;
				if (phase.kind === 'solving' || phase.kind === 'handing-over' || phase.kind === 'buying') {
					if (rng.chance(0.08)) intent = { type: 'back' };
					else {
						const answer = typed(rng, phase.puzzle, 0.55);
						intent = { type: 'answer', input: answer.input };
						meant = answer.right;
						if (meant) counted.set(phase.kind, (counted.get(phase.kind) ?? 0) + 1);
					}
				} else {
					const hurt = [...state.party.keys()].filter((j) => needsHealing(state.party[j]!));
					const roll = rng.next();
					if (roll < 0.03) intent = { type: 'leave' };
					else if (roll < 0.08) intent = { type: 'answer', input: '1' };
					else if (roll < 0.3) {
						const picked = state.party.filter(() => rng.chance(0.3)).map((a) => a.id);
						intent = { type: 'hand-over', ids: picked };
					} else if (roll < 0.5) intent = { type: 'buy', itemId: rng.pick(ITEM_IDS) };
					else if (hurt.length > 0) intent = { type: 'pick-patient', partyIndex: rng.pick(hurt) };
					else intent = { type: 'leave' };
				}
				const step = applyDoctorIntent(state, intent, seed);
				const after = countSolved(solved, step.events);
				if (after !== solved + (meant ? 1 : 0)) {
					bad.push(
						`seed ${seed}: ${JSON.stringify(intent)} in ${phase.kind}: ${solved} → ${after}`
					);
				}
				solved = after;
				state = step.state;
			}
		}
		expect(findings(bad)).toEqual([]);
		// Every kind of sum was answered right somewhere: a heal, a hand-over, a purchase.
		for (const kind of ['solving', 'handing-over', 'buying']) {
			expect(counted.get(kind) ?? 0, kind).toBeGreaterThan(5);
		}
	});

	it("in friendly matches, each side's right answers count for that side alone", () => {
		const land = ['squirrel', 'rabbit', 'frog', 'fox', 'otter', 'deer', 'wolf', 'bear'];
		const bad: string[] = [];
		const right: Record<MatchSide, number> = { a: 0, b: 0 };
		for (let seed = 0; seed < 30; seed++) {
			const rng = new Rng(hashInts(seed, 0x3a7c4));
			const pick = () => matchParty([0, 1, 2].map(() => rng.pick(land)));
			let state = startMatch({ a: pick(), b: pick() }, seed);
			const solved: Record<MatchSide, number> = { a: 0, b: 10 };
			for (let i = 0; i < 3000; i++) {
				const phase = state.phase;
				if (phase.kind === 'ended') break;
				let side: MatchSide = phase.side;
				let intent: MatchIntent;
				let meant = false;
				if (phase.kind === 'solving') {
					const answer = typed(rng, phase.puzzle, 0.5);
					intent = { type: 'answer', input: answer.input };
					meant = answer.right;
					if (meant) right[side]++;
				} else if (rng.chance(0.05)) {
					// The side not acting answers anyway: refused, and nothing counts.
					side = side === 'a' ? 'b' : 'a';
					intent = { type: 'answer', input: '1' };
				} else {
					const next = nextMatchIntent(state, { accuracy: 0, policy: 'random', switch: 0.1 }, rng)!;
					side = next.side;
					intent = next.intent;
				}
				const step = applyMatchIntent(state, side, intent, seed);
				for (const who of ['a', 'b'] as const) {
					const after = countSolved(solved[who], step.events, who);
					const expected = solved[who] + (meant && who === side ? 1 : 0);
					if (after !== expected) {
						bad.push(
							`seed ${seed}: ${side} sent ${JSON.stringify(intent)}; ${who} ${solved[who]} → ${after}`
						);
					}
					solved[who] = after;
				}
				state = step.state;
			}
		}
		expect(findings(bad)).toEqual([]);
		expect(right.a).toBeGreaterThan(50);
		expect(right.b).toBeGreaterThan(50);
	});
});
