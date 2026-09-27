import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import type { MatchSide } from '../src/match/types.js';
import { Rng, hashInts } from '../src/rng.js';
import { party, playMatch, type MatchPlayer } from './match-sim.js';

/**
 * How friendly matches play out ([[PRODUCT]] §4 "Friendly matches"): who
 * wins, and how many turns and puzzles a match takes, over whole 3-v-3
 * matches between scripted kids. The pinned lines keep §4's numbers true;
 * `SIM=1` prints every table the PR's balance section was built from.
 */

const PRINT = Boolean(process.env.SIM);

/** A team of each tier from the land animals, three of a kind where the tier has fewer. */
const TIER_TEAMS: Readonly<Record<number, readonly string[]>> = {
	1: ['squirrel', 'rabbit', 'frog'],
	2: ['fox', 'otter', 'fox'],
	3: ['deer', 'deer', 'deer'],
	4: ['wolf', 'wolf', 'wolf'],
	5: ['bear', 'bear', 'bear']
};

/** A kid right `accuracy` of the time, picking a random attack at a random level. */
const kid = (accuracy: number, more: Partial<MatchPlayer> = {}): MatchPlayer => ({
	accuracy,
	policy: 'random',
	...more
});

interface Outcome {
	/** How often side `a` won. */
	aWins: number;
	/** How often the side that started won. */
	starterWins: number;
	turns: number;
	puzzles: number;
	/** 90th percentile of puzzles per match. */
	puzzles90: number;
}

function simulate(
	a: readonly string[],
	b: readonly string[],
	players: Readonly<Record<MatchSide, MatchPlayer>>,
	matches: number
): Outcome {
	return simulateDrawn(
		() => a,
		() => b,
		players,
		matches
	);
}

/** `simulate` with each side's team drawn for each match (by its seed). */
function simulateDrawn(
	a: (seed: number) => readonly string[],
	b: (seed: number) => readonly string[],
	players: Readonly<Record<MatchSide, MatchPlayer>>,
	matches: number
): Outcome {
	let aWins = 0;
	let starterWins = 0;
	let turns = 0;
	const puzzles: number[] = [];
	for (let seed = 0; seed < matches; seed++) {
		const { state, events, log } = playMatch(
			seed,
			{ a: party(a(seed)), b: party(b(seed)) },
			players
		);
		if (state.phase.kind !== 'ended') throw new Error(`seed ${seed} never ended`);
		if (state.phase.winner === 'a') aWins++;
		if (state.phase.winner === log[0]!.side) starterWins++;
		turns += state.turn;
		puzzles.push(events.filter((e) => e.type === 'puzzle-shown').length);
	}
	puzzles.sort((x, y) => x - y);
	return {
		aWins: aWins / matches,
		starterWins: starterWins / matches,
		turns: turns / matches,
		puzzles: puzzles.reduce((s, x) => s + x, 0) / matches,
		puzzles90: puzzles[Math.floor(matches * 0.9)]!
	};
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const one = (x: number) => x.toFixed(1);

describe('friendly-match balance', () => {
	it('pins §4: an even tier-1 match takes about 20 puzzles, the starter wins a little more often, skill counts, and one tier up decides', () => {
		const even = simulate(TIER_TEAMS[1]!, TIER_TEAMS[1]!, { a: kid(0.7), b: kid(0.7) }, 1000);
		expect(even.puzzles).toBeGreaterThan(18);
		expect(even.puzzles).toBeLessThan(23);
		expect(even.starterWins).toBeGreaterThan(0.5);
		expect(even.starterWins).toBeLessThan(0.64);

		const skill = simulate(TIER_TEAMS[1]!, TIER_TEAMS[1]!, { a: kid(0.9), b: kid(0.7) }, 1000);
		expect(skill.aWins).toBeGreaterThan(0.72);
		expect(skill.aWins).toBeLessThan(0.86);

		const size = simulate(TIER_TEAMS[1]!, TIER_TEAMS[2]!, { a: kid(0.7), b: kid(0.7) }, 1000);
		expect(size.aWins).toBeLessThan(0.05);
		// 3,000 whole matches: 0.14 s on a quiet machine, 0.8 s alone at a load
		// of 31 (2026-09-27), several times that inside the whole suite.
	}, 30_000);

	it('pins §4 for teams drawn from each tier: an even tier-1 match takes about 20 puzzles, and one tier up decides', () => {
		// Three animals drawn for each match from a tier's land animals (repeats allowed, as a
		// kid's party may hold them), with a seed of their own: the small animals of #89 play
		// as the prototype's three did.
		const land = (tier: number) =>
			ANIMALS.filter((a) => a.tier === tier && a.realms.includes('land')).map((a) => a.id);
		const drawn = (tier: number, salt: number) => (seed: number) => {
			const rng = new Rng(hashInts(seed, salt));
			const pool = land(tier);
			return [0, 1, 2].map(() => pool[rng.int(0, pool.length - 1)]!);
		};
		expect(land(1).length).toBeGreaterThan(3);
		const even = simulateDrawn(drawn(1, 1), drawn(1, 2), { a: kid(0.7), b: kid(0.7) }, 1000);
		expect(even.puzzles).toBeGreaterThan(18);
		expect(even.puzzles).toBeLessThan(23);
		expect(even.starterWins).toBeGreaterThan(0.5);
		expect(even.starterWins).toBeLessThan(0.64);
		const size = simulateDrawn(drawn(1, 1), drawn(2, 2), { a: kid(0.7), b: kid(0.7) }, 1000);
		expect(size.aWins).toBeLessThan(1 / 12);
		// 2,000 whole matches: about 0.2 s alone, a few times that under load.
	}, 30_000);

	// The printed tables run only with SIM=1: 45,000 and 24,000 whole matches,
	// about 2 s each alone and a minute under load.
	it.runIf(PRINT)(
		'prints tier against tier, both kids right as often',
		() => {
			const lines = [
				'| tiers (a v b) | right | a wins | starter wins | turns = puzzles | puzzles, 90th pct |',
				'| --- | --- | --- | --- | --- | --- |'
			];
			for (let ta = 1; ta <= 5; ta++) {
				for (let tb = ta; tb <= 5; tb++) {
					for (const accuracy of [0.9, 0.7, 0.5]) {
						const o = simulate(
							TIER_TEAMS[ta]!,
							TIER_TEAMS[tb]!,
							{ a: kid(accuracy), b: kid(accuracy) },
							1000
						);
						lines.push(
							`| ${ta} v ${tb} | ${pct(accuracy)} | ${pct(o.aWins)} | ${pct(o.starterWins)} | ${one(o.puzzles)} | ${o.puzzles90} |`
						);
					}
				}
			}
			console.log(lines.join('\n'));
		},
		600_000
	);

	it.runIf(PRINT)(
		'prints skill against skill, skill against size, and habits',
		() => {
			const rows: [string, readonly string[], MatchPlayer, readonly string[], MatchPlayer][] = [
				['tier 1 at 90% v tier 1 at 70%', TIER_TEAMS[1]!, kid(0.9), TIER_TEAMS[1]!, kid(0.7)],
				['tier 1 at 90% v tier 1 at 50%', TIER_TEAMS[1]!, kid(0.9), TIER_TEAMS[1]!, kid(0.5)],
				['tier 1 at 70% v tier 1 at 50%', TIER_TEAMS[1]!, kid(0.7), TIER_TEAMS[1]!, kid(0.5)],
				['tier 1 at 90% v tier 2 at 70%', TIER_TEAMS[1]!, kid(0.9), TIER_TEAMS[2]!, kid(0.7)],
				['tier 1 at 90% v tier 2 at 50%', TIER_TEAMS[1]!, kid(0.9), TIER_TEAMS[2]!, kid(0.5)],
				['tier 2 at 90% v tier 3 at 50%', TIER_TEAMS[2]!, kid(0.9), TIER_TEAMS[3]!, kid(0.5)],
				['tier 3 at 90% v tier 4 at 50%', TIER_TEAMS[3]!, kid(0.9), TIER_TEAMS[4]!, kid(0.5)],
				['tier 4 at 90% v tier 5 at 50%', TIER_TEAMS[4]!, kid(0.9), TIER_TEAMS[5]!, kid(0.5)],
				[
					'tier 1, both 70%, always the easiest',
					TIER_TEAMS[1]!,
					kid(0.7, { policy: 'min' }),
					TIER_TEAMS[1]!,
					kid(0.7, { policy: 'min' })
				],
				[
					'tier 1, both 70%, always the hardest',
					TIER_TEAMS[1]!,
					kid(0.7, { policy: 'max' }),
					TIER_TEAMS[1]!,
					kid(0.7, { policy: 'max' })
				],
				[
					'tier 1, both 70%, switching 1 turn in 5',
					TIER_TEAMS[1]!,
					kid(0.7, { switch: 0.2 }),
					TIER_TEAMS[1]!,
					kid(0.7, { switch: 0.2 })
				],
				[
					'tier 5, both 70%, always the easiest',
					TIER_TEAMS[5]!,
					kid(0.7, { policy: 'min' }),
					TIER_TEAMS[5]!,
					kid(0.7, { policy: 'min' })
				]
			];
			const lines = [
				'| match | a wins | starter wins | turns | puzzles | puzzles, 90th pct |',
				'| --- | --- | --- | --- | --- | --- |'
			];
			for (const [name, a, pa, b, pb] of rows) {
				const o = simulate(a, b, { a: pa, b: pb }, 2000);
				lines.push(
					`| ${name} | ${pct(o.aWins)} | ${pct(o.starterWins)} | ${one(o.turns)} | ${one(o.puzzles)} | ${o.puzzles90} |`
				);
			}
			console.log(lines.join('\n'));
		},
		600_000
	);
});
