import { describe, expect, it } from 'vitest';
import { ANIMALS, getAnimal } from '../src/animals/catalog.js';
import type { AttackLevel, Biome } from '../src/animals/types.js';
import { hashString } from '../src/rng.js';
import { SAFE_RADIUS, distanceFromSpawn, encounterTableAt } from '../src/world/encounters.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { surroundings } from '../src/world/habitat.js';
import {
	arena,
	makeParty,
	makeWild,
	playBattle,
	type PlayerModel,
	type Policy
} from './battle-sim.js';
import { turn } from './turn.js';

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
 * Sampling slack on a target band. A mean over the same-tier pairs (337 since
 * #89's second wave) at 1000 seeds each has a standard error well under half a
 * point, so 2 points is over four standard errors: the band, not the dice,
 * decides the test.
 */
const SLACK = 0.02;
const PRINT = Boolean(process.env.SIM);

interface Outcome {
	win: number;
	rounds: number;
}

const ids = ANIMALS.map((a) => a.id);
const tier = (id: string) => getAnimal(id).tier;

/**
 * Every (player, wild) pair that can meet: the two "never hurts" checks walk
 * them all, so a balance change that breaks either anywhere in the catalog
 * fails ([[DEVELOPMENT]] § Testing ideology). Over 1,300 pairs since #89's
 * second wave.
 */
const MEETING_PAIRS: readonly (readonly [string, string])[] = ids.flatMap((p) =>
	ids.flatMap((w) => (arena(p, w) !== null ? [[p, w] as const] : []))
);

/** Every (player, wild) pair that can meet, where the wild animal is `gap` tiers fiercer. */
function pairs(gap: number): Array<[string, string]> {
	return ids.flatMap((p) =>
		ids
			.filter((w) => tier(w) - tier(p) === gap && arena(p, w) !== null)
			.map((w): [string, string] => [p, w])
	);
}

/**
 * The battles played so far, for each pair and player: how many of the first
 * n seeds were won, and their rounds, at index n. Seeds count up from 0, so a
 * run of 200 is the start of a run of 1,000, and a check at 200 seeds reads
 * the first 200 of a pair already played at 1,000.
 */
const played = new Map<string, { wins: number[]; rounds: number[] }>();
function simulate(playerId: string, wildId: string, model: PlayerModel, seeds = SEEDS): Outcome {
	const key = `${playerId}>${wildId}|${model.policy}|${model.level}|${model.accuracy}`;
	let so = played.get(key);
	if (!so) played.set(key, (so = { wins: [0], rounds: [0] }));
	const realm = arena(playerId, wildId);
	if (realm === null) throw new Error(`${playerId} and ${wildId} never meet`);
	for (let seed = so.wins.length - 1; seed < seeds; seed++) {
		const party = makeParty([playerId]);
		const { state } = playBattle(seed, party, makeWild(wildId), model, undefined, 2000, realm);
		if (state.phase.kind !== 'ended') throw new Error('battle did not end');
		so.wins.push(so.wins[seed]! + (state.phase.outcome === 'won' ? 1 : 0));
		so.rounds.push(so.rounds[seed]! + state.turn);
	}
	return { win: so.wins[seeds]! / seeds, rounds: so.rounds[seeds]! / seeds };
}

/** The kid the targets are about: the easiest puzzle, the weakest attack at level 1. */
const easiest = (accuracy: number): PlayerModel => ({ accuracy, policy: 'min', level: 1 });
/** The strongest attack at level 3: the hardest puzzles the animal can ask. */
const hardest = (accuracy: number): PlayerModel => ({ accuracy, policy: 'max', level: 3 });

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const winRates = (gap: number, model: PlayerModel, seeds = TARGET_SEEDS) =>
	pairs(gap).map(([p, w]) => ({ p, w, win: simulate(p, w, model, seeds).win }));

/** `winRates`, turning the worker's event loop every ten pairs, for the tests' long sweeps. */
async function winRatesTurning(gap: number, model: PlayerModel, seeds = TARGET_SEEDS) {
	const rates: { p: string; w: string; win: number }[] = [];
	for (const [i, [p, w]] of pairs(gap).entries()) {
		if (i % 10 === 0) await turn();
		rates.push({ p, w, win: simulate(p, w, model, seeds).win });
	}
	return rates;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function grid(model: PlayerModel): string {
	const name = `${model.policy === 'min' ? 'weakest' : model.policy === 'max' ? 'strongest' : 'random'} attack, level ${model.level ?? 'random'}, right ${pct(model.accuracy)}`;
	const head = `| player \\ wild | ${ids.join(' | ')} |`;
	const sep = `| --- | ${ids.map(() => '---').join(' | ')} |`;
	const rows = ids.map((p) => {
		const cells = ids.map((w) => {
			if (arena(p, w) === null) return '—';
			const { win, rounds } = simulate(p, w, model);
			return `${pct(win)} (${rounds.toFixed(1)})`;
		});
		return `| **${p}** | ${cells.join(' | ')} |`;
	});
	return [`**${name}** — win rate (mean rounds)`, '', head, sep, ...rows].join('\n');
}

/**
 * The tier-1 animals a starter meets near home, and how often: over every
 * tall-grass tile of the prototype world within the safe radius of spawn (of
 * one biome, or all), the tier-1 part of the table the ground there makes,
 * normalised. Mostly rabbits, shrews, hedgehogs and moles in the open meadow,
 * frogs, brown rats and toads by the water, and squirrels, wood mice and robins
 * by the trees.
 */
function nearHomeMix(biome?: Biome): Map<string, number> {
	const seed = hashString('prototype');
	const spawn = spawnPoint(seed);
	const mix = new Map<string, number>();
	for (let y = spawn.y - SAFE_RADIUS; y <= spawn.y + SAFE_RADIUS; y++) {
		for (let x = spawn.x - SAFE_RADIUS; x <= spawn.x + SAFE_RADIUS; x++) {
			const pos = { x, y };
			const tile = tileAtWorld(seed, x, y);
			if (tile.kind !== 'tallgrass' || distanceFromSpawn(pos, spawn) > SAFE_RADIUS) continue;
			if (biome && tile.biome !== biome) continue;
			const site = { tile, pos, spawn, around: surroundings(seed, pos) };
			for (const e of encounterTableAt(site, 1))
				if (e.species.tier === 1) mix.set(e.species.id, (mix.get(e.species.id) ?? 0) + e.weight);
		}
	}
	const sum = [...mix.values()].reduce((a, b) => a + b, 0);
	return new Map([...mix].map(([id, w]) => [id, w / sum]));
}

/**
 * The starter against its own tier near spawn, as the ground brings them
 * out: all the tall grass near home, then the meadow's and the river's alone.
 * The reed beside the prototype world's spawn tile, by the lake, is where a
 * new game's first battles happen.
 */
const STARTER_MIXES: Record<string, ReadonlyMap<string, number>> = {
	'the tier-1 animals near home': nearHomeMix(),
	'the meadow near home': nearHomeMix('meadow'),
	'the river near home': nearHomeMix('river')
};
const mixWords = (mix: ReadonlyMap<string, number>) =>
	[...mix].map(([id, w]) => `${id} ${pct(w)}`).join(', ');
const starterWin = (model: PlayerModel, mix: ReadonlyMap<string, number>) =>
	[...mix].reduce(
		(sum, [w, share]) => sum + share * simulate('squirrel', w, model, TARGET_SEEDS).win,
		0
	);

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
	for (const [name, mix] of Object.entries(STARTER_MIXES)) {
		for (const [acc, target] of [
			[1, '65–80%'],
			[0.85, '—'],
			[0.7, '40–55%']
		] as const) {
			rows.push(
				`| starter squirrel vs ${name} (${mixWords(mix)}) | easiest puzzle, right ${pct(acc)} | ${target} | ${pct(starterWin(easiest(acc), mix))} | — |`
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

	it("a squirrel almost never beats a bear, even when it's always right, nor a crab a whale, nor any small animal a tier-5 one", () => {
		const small = ids.filter((id) => tier(id) === 1);
		expect(small).toEqual([
			'squirrel',
			'rabbit',
			'frog',
			'shrew',
			'wood-mouse',
			'brown-rat',
			'hedgehog',
			'mole',
			'common-lizard',
			'common-toad',
			'robin',
			'stag-beetle',
			'crab',
			'starfish'
		]);
		// Every small animal of the land meets the bear, the moose and the bison (#89); at sea,
		// the whale meets the two small sea animals and the two small ones that swim, the frog
		// and the toad.
		for (const [big, meeting] of [
			['bear', 12],
			['moose', 12],
			['european-bison', 12],
			['whale', 4]
		] as const) {
			const meet = small.filter((id) => arena(id, big) !== null);
			expect(meet.length, `tier-1 animals that meet the ${big}`).toBe(meeting);
			for (const id of meet)
				expect(simulate(id, big, hardest(1)).win, `${id} vs ${big}`).toBeLessThan(0.05);
		}
		expect(ids.filter((id) => tier(id) === 5)).toEqual([
			'bear',
			'moose',
			'european-bison',
			'whale'
		]);
		// 40 pairs, 200 battles each: under a second alone, a few beside the suite under load.
	}, 30_000);

	it('each sea animal is its land twin in numbers, so the land balance holds at sea as it is', () => {
		const twins: Record<string, string> = {
			crab: 'rabbit',
			starfish: 'frog',
			turtle: 'otter',
			dolphin: 'deer',
			octopus: 'wolf',
			whale: 'bear'
		};
		const sea = ANIMALS.filter((a) => !a.realms.includes('land')).map((a) => a.id);
		expect(Object.keys(twins)).toEqual(sea);
		const numbers = (id: string) => {
			const a = getAnimal(id);
			return [a.tier, a.maxHp, a.catchRate, a.attacks.map((k) => k.power)];
		};
		for (const [id, twin] of Object.entries(twins)) expect(numbers(id), id).toEqual(numbers(twin));
		// The small ones ask sums and number patterns, never a times-table sum.
		for (const id of sea.filter((s) => tier(s) === 1)) {
			const kinds = new Set(getAnimal(id).attacks.flatMap((k) => k.kinds));
			for (const kind of kinds)
				expect(['add', 'sub', 'sequence'], `${id} asks ${kind}`).toContain(kind);
		}
	});

	it('a bear beats a squirrel almost always, even at 70% accuracy, and a whale a crab', () => {
		expect(simulate('bear', 'squirrel', hardest(0.7)).win).toBeGreaterThan(0.95);
		expect(simulate('whale', 'crab', hardest(0.7)).win).toBeGreaterThan(0.95);
	});

	it('an always-right player beats their own species with its strongest attack', () => {
		for (const id of ids) {
			expect(simulate(id, id, hardest(1)).win, `${id} mirror`).toBeGreaterThanOrEqual(0.9);
		}
	});

	// The two sweeps below play every same-tier pair that can meet (337 since #89's second
	// wave), 1,000 battles each, with the seeds the bands were set on: 12 and 14 s alone at a
	// load average of 10, 60 and 62 s beside the rest of the engine's suite at 120, so they
	// turn the worker's loop as they go. At a load of 150 a test takes up to ten times its run
	// alone, so the bounds are three times that.
	it('the easiest puzzle, always right, usually beats an animal of your own tier (65–80%)', async () => {
		const rates = await winRatesTurning(0, easiest(1));
		for (const { p, w, win } of rates) expect(win, `${p} vs ${w}`).toBeGreaterThan(0.5);
		expectInBand(mean(rates.map((r) => r.win)), 0.65, 0.8, 'same-tier mean');
		// Played first, it paid for the start of the run as well: 38 s in the whole suite at a
		// load average of 34 (2026-09-28), which scales to 170 s at 150.
	}, 600_000);

	it('the easiest puzzle at 70% right makes a same-tier fight close to a coin flip (40–55%)', async () => {
		const rates = await winRatesTurning(0, easiest(0.7));
		expectInBand(mean(rates.map((r) => r.win)), 0.4, 0.55, 'same-tier mean');
	}, 480_000);

	it('the starter squirrel meets the same targets against its own near-spawn tier', () => {
		for (const name of ['the tier-1 animals near home', 'the river near home']) {
			const mix = STARTER_MIXES[name]!;
			expectInBand(starterWin(easiest(1), mix), 0.65, 0.8, `starter vs ${name}, always right`);
			expectInBand(starterWin(easiest(0.7), mix), 0.4, 0.55, `starter vs ${name}, right 70%`);
		}
		// The open meadow is the ground of the rabbits, shrews, hedgehogs and moles
		// (18% each of its tier-1 animals near home), and the rabbit and the mole are
		// the hardest small animals for a squirrel: there a squirrel starter right 7
		// times in 10 wins about 36%, below the band, and at least one fight in three
		// (all rabbits would be 28%, all moles 27%).
		const meadow = STARTER_MIXES['the meadow near home']!;
		expectInBand(starterWin(easiest(1), meadow), 0.65, 0.8, 'starter vs the meadow, always right');
		const shaky = starterWin(easiest(0.7), meadow);
		expect(shaky, 'starter vs the meadow, right 70%').toBeGreaterThanOrEqual(1 / 3);
		expect(shaky, 'starter vs the meadow, right 70%').toBeLessThanOrEqual(0.55 + SLACK);
	});

	it('on the easiest puzzle, one tier up is hard and two tiers up is out of reach', async () => {
		for (const { p, w, win } of await winRatesTurning(1, easiest(1)))
			expect(win, `${p} vs ${w}`).toBeLessThan(0.35);
		for (const { p, w, win } of await winRatesTurning(2, easiest(1)))
			expect(win, `${p} vs ${w}`).toBeLessThan(0.1);
		// 352 pairs, 1,000 battles each since #89's second wave: 7.5 s alone at a load average of
		// 10, 28 s beside the suite at 120, and up to ten times its run alone at 150.
	}, 240_000);

	it('being right more often never hurts', async () => {
		const bad: string[] = [];
		for (const model of [hardest, easiest]) {
			for (const [i, [p, w]] of MEETING_PAIRS.entries()) {
				if (i % 25 === 0) await turn();
				const sure = simulate(p, w, model(1)).win;
				const shaky = simulate(p, w, model(0.7)).win;
				if (!(sure >= shaky - 0.05)) bad.push(`${p} vs ${w}, ${model.name}: ${sure} < ${shaky}`);
			}
		}
		expect(bad).toEqual([]);
		// Every pair, four models, 200 battles each (about a million battles with the 41 animals
		// of #89's second wave, less the pairs the sweeps above played at 1,000 seeds, whose first
		// 200 it reads): 15 s alone at a load average of 10, 71 s beside the suite at 120 before
		// it read them, and up to ten times its run alone at 150. It turns the worker's loop as
		// it goes.
	}, 480_000);

	it('a stronger attack at a higher level never hurts an always-right player', () => {
		const bad: string[] = [];
		for (const [p, w] of MEETING_PAIRS) {
			const strong = simulate(p, w, hardest(1)).win;
			const weak = simulate(p, w, easiest(1)).win;
			if (!(strong >= weak - 0.05)) bad.push(`${p} vs ${w}: ${strong} < ${weak}`);
		}
		expect(bad).toEqual([]);
		// The two models' battles are the test above's, kept: well under a second.
	}, 30_000);
});
