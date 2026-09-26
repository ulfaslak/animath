import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AttackLevel } from '../src/animals/types.js';
import { makeParty, makeWild, playBattle, type PlayerModel, type Policy } from './battle-sim.js';

/**
 * Balance: species × species battles with a scripted player, party of one, who
 * only attacks. The assertions pin the claims [[PRODUCT]] §4 makes in prose:
 * a kid who picks the easiest puzzle and is always right usually beats an
 * animal of their own tier, and "don't face a bear with a squirrel". Run with
 * `SIM=1` to print the whole harness (every policy × accuracy × level):
 *
 *   SIM=1 pnpm -F @mathgame/engine exec vitest run test/balance.test.ts
 */
const SEEDS = 200;
/** More seeds where a test compares a win rate with a target band. */
const TARGET_SEEDS = 1000;
/**
 * Sampling slack on a target band. A mean over the 16 same-tier pairs at 1000
 * seeds each has a standard error under half a point, so 2 points is over
 * four standard errors: the band, not the dice, decides the test.
 */
const SLACK = 0.02;
const PRINT = Boolean(process.env.SIM);

interface Outcome {
	win: number;
	rounds: number;
}

const ids = ANIMALS.map((a) => a.id);
const tier = (id: string) => getAnimal(id).tier;

/** Every (player, wild) pair where the wild animal is `gap` tiers fiercer. */
function pairs(gap: number): Array<[string, string]> {
	return ids.flatMap((p) =>
		ids.filter((w) => tier(w) - tier(p) === gap).map((w): [string, string] => [p, w])
	);
}

const cache = new Map<string, Outcome>();
function simulate(playerId: string, wildId: string, model: PlayerModel, seeds = SEEDS): Outcome {
	const key = `${playerId}>${wildId}|${model.policy}|${model.level}|${model.accuracy}|${seeds}`;
	const hit = cache.get(key);
	if (hit) return hit;
	let wins = 0;
	let rounds = 0;
	for (let seed = 0; seed < seeds; seed++) {
		const { state } = playBattle(seed, makeParty([playerId]), makeWild(wildId), model);
		if (state.phase.kind !== 'ended') throw new Error('battle did not end');
		if (state.phase.outcome === 'won') wins++;
		rounds += state.turn;
	}
	const out = { win: wins / seeds, rounds: rounds / seeds };
	cache.set(key, out);
	return out;
}

/** The kid the targets are about: the easiest puzzle, the weakest attack at level 1. */
const easiest = (accuracy: number): PlayerModel => ({ accuracy, policy: 'min', level: 1 });
/** The strongest attack at level 3: the hardest puzzles the animal can ask. */
const hardest = (accuracy: number): PlayerModel => ({ accuracy, policy: 'max', level: 3 });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const winRates = (gap: number, model: PlayerModel, seeds = TARGET_SEEDS) =>
	pairs(gap).map(([p, w]) => ({ p, w, win: simulate(p, w, model, seeds).win }));

const pct = (x: number) => `${Math.round(x * 100)}%`;

function grid(model: PlayerModel): string {
	const name = `${model.policy === 'min' ? 'weakest' : model.policy === 'max' ? 'strongest' : 'random'} attack, level ${model.level ?? 'random'}, right ${pct(model.accuracy)}`;
	const head = `| player \\ wild | ${ids.join(' | ')} |`;
	const sep = `| --- | ${ids.map(() => '---').join(' | ')} |`;
	const rows = ids.map((p) => {
		const cells = ids.map((w) => {
			const { win, rounds } = simulate(p, w, model);
			return `${pct(win)} (${rounds.toFixed(1)})`;
		});
		return `| **${p}** | ${cells.join(' | ')} |`;
	});
	return [`**${name}** — win rate (mean rounds)`, '', head, sep, ...rows].join('\n');
}

/**
 * The starter against its own tier near spawn. In the meadow a wild squirrel
 * or a wild rabbit, equally likely; at the river a squirrel, a rabbit or a
 * frog (the squirrels and rabbits come down to the frogs' reeds), and the reed
 * beside the prototype world's spawn tile is where a new game's first battles
 * happen.
 */
const STARTER_MIXES: Record<string, readonly string[]> = {
	'squirrel or rabbit (the meadow)': ['squirrel', 'rabbit'],
	'squirrel, rabbit or frog (the river)': ['squirrel', 'rabbit', 'frog']
};
const starterWin = (model: PlayerModel, wild: readonly string[]) =>
	mean(wild.map((w) => simulate('squirrel', w, model, TARGET_SEEDS).win));

function targets(): string {
	const rows: string[] = [
		`| matchup | player | target (tests allow ±${SLACK * 100} points of sampling) | mean | range |`,
		'| --- | --- | --- | --- | --- |'
	];
	const row = (label: string, gap: number, model: PlayerModel, target: string) => {
		const w = winRates(gap, model).map((r) => r.win);
		rows.push(
			`| ${label} | easiest puzzle, right ${pct(model.accuracy)} | ${target} | ${pct(mean(w))} | ${pct(Math.min(...w))}–${pct(Math.max(...w))} |`
		);
	};
	row('same tier', 0, easiest(1), '65–80%');
	row('same tier', 0, easiest(0.85), '—');
	row('same tier', 0, easiest(0.7), '40–55%');
	row('one tier up', 1, easiest(1), 'under 35%');
	row('two tiers up', 2, easiest(1), 'under 10%');
	for (const [mix, wild] of Object.entries(STARTER_MIXES)) {
		for (const [acc, target] of [
			[1, '65–80%'],
			[0.85, '—'],
			[0.7, '40–55%']
		] as const) {
			rows.push(
				`| starter squirrel vs ${mix} | easiest puzzle, right ${pct(acc)} | ${target} | ${pct(starterWin(easiest(acc), wild))} | — |`
			);
		}
	}
	return rows.join('\n');
}

/** `x` is inside `[lo, hi]` up to sampling slack. */
function expectInBand(x: number, lo: number, hi: number, what: string): void {
	expect(x, what).toBeGreaterThanOrEqual(lo - SLACK);
	expect(x, what).toBeLessThanOrEqual(hi + SLACK);
}

describe('balance simulation', () => {
	if (PRINT) {
		it('prints the tables', () => {
			const models: PlayerModel[] = [];
			for (const policy of ['min', 'max', 'random'] as Policy[])
				for (const accuracy of [1, 0.85, 0.7])
					for (const level of [1, 2, 3] as AttackLevel[]) models.push({ accuracy, policy, level });
			console.log('\n' + [targets(), ...models.map(grid)].join('\n\n') + '\n');
			// Every species pair under 27 models: 18 s with eight species on a loaded machine.
		}, 120_000);
	}

	it("a squirrel almost never beats a bear, even when it's always right", () => {
		const small = ids.filter((id) => tier(id) === 1);
		expect(small).toEqual(['squirrel', 'rabbit', 'frog']);
		for (const id of small)
			expect(simulate(id, 'bear', hardest(1)).win, `${id} vs bear`).toBeLessThan(0.05);
	});

	it('a bear beats a squirrel almost always, even at 70% accuracy', () => {
		expect(simulate('bear', 'squirrel', hardest(0.7)).win).toBeGreaterThan(0.95);
	});

	it('an always-right player beats their own species with its strongest attack', () => {
		for (const id of ids) {
			expect(simulate(id, id, hardest(1)).win, `${id} mirror`).toBeGreaterThanOrEqual(0.9);
		}
	});

	it('the easiest puzzle, always right, usually beats an animal of your own tier (65–80%)', () => {
		const rates = winRates(0, easiest(1));
		for (const { p, w, win } of rates) expect(win, `${p} vs ${w}`).toBeGreaterThan(0.5);
		expectInBand(mean(rates.map((r) => r.win)), 0.65, 0.8, 'same-tier mean');
	});

	it('the easiest puzzle at 70% right makes a same-tier fight close to a coin flip (40–55%)', () => {
		expectInBand(mean(winRates(0, easiest(0.7)).map((r) => r.win)), 0.4, 0.55, 'same-tier mean');
	});

	it('the starter squirrel meets the same targets against its own near-spawn tier', () => {
		for (const [mix, wild] of Object.entries(STARTER_MIXES)) {
			expectInBand(starterWin(easiest(1), wild), 0.65, 0.8, `starter vs ${mix}, always right`);
			expectInBand(starterWin(easiest(0.7), wild), 0.4, 0.55, `starter vs ${mix}, right 70%`);
		}
	});

	it('on the easiest puzzle, one tier up is hard and two tiers up is out of reach', () => {
		for (const { p, w, win } of winRates(1, easiest(1)))
			expect(win, `${p} vs ${w}`).toBeLessThan(0.35);
		for (const { p, w, win } of winRates(2, easiest(1)))
			expect(win, `${p} vs ${w}`).toBeLessThan(0.1);
	});

	it('being right more often never hurts', () => {
		for (const model of [hardest, easiest]) {
			for (const p of ids) {
				for (const w of ids) {
					const sure = simulate(p, w, model(1)).win;
					const shaky = simulate(p, w, model(0.7)).win;
					expect(sure, `${p} vs ${w}, ${model.name}`).toBeGreaterThanOrEqual(shaky - 0.05);
				}
			}
		}
	});

	it('a stronger attack at a higher level never hurts an always-right player', () => {
		for (const p of ids) {
			for (const w of ids) {
				const strong = simulate(p, w, hardest(1)).win;
				const weak = simulate(p, w, easiest(1)).win;
				expect(strong, `${p} vs ${w}`).toBeGreaterThanOrEqual(weak - 0.05);
			}
		}
	});
});
