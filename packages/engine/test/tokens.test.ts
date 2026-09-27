import { describe, expect, it } from 'vitest';
import { getAnimal } from '../src/animals/catalog.js';
import type { AnimalInstance, AttackLevel, Tier } from '../src/animals/types.js';
import { applyBattleIntent, startBattle } from '../src/battle/reducer.js';
import type { BattleIntent } from '../src/battle/types.js';
import { tokensForTier } from '../src/doctor/tokens.js';
import { Rng, hashInts, hashString } from '../src/rng.js';
import { encounterTable } from '../src/world/encounters.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import type { GridPos, Tile } from '../src/world/types.js';

/**
 * Tokens against the battles that earn them ([[PRODUCT]] §4 "Tokens and the
 * doctor's shop"): catching the smallest animals over and over must never be
 * the fastest way to the shop. Measured per battle, with the engine's own
 * battles, encounter tables and catch odds, and no clock, so it holds however
 * fast a kid reads: every catch goes home, and a battle earns what its catch
 * brings. `SIM=1` prints the table.
 */

const SEED = hashString('prototype');
const spawn = spawnPoint(SEED);
const BATTLES = 1500;

interface Kid {
	/** Chance an answer is right. */
	accuracy: number;
	/** Chance a battle is one the kid means to catch. */
	catchWant: number;
	/** The leash flies once the wild animal's HP is at or below this fraction. */
	throwAt: number;
	/** How often each level is picked: easy, medium, hard. */
	levels: readonly [number, number, number];
	/** Only the weakest attack (a farmer keeps the wild animal standing for the leash). */
	weakest: boolean;
}

/** An ordinary kid: right 4 times in 5, mostly easy, out to catch every other battle. */
const ORDINARY: Kid = {
	accuracy: 0.8,
	catchWant: 0.5,
	throwAt: 0.4,
	levels: [0.6, 0.3, 0.1],
	weakest: false
};
/** A kid farming tokens: the weakest attack on easy, the leash at every weak animal, rarely wrong. */
const FARMER: Kid = {
	accuracy: 0.95,
	catchWant: 1,
	throwAt: 0.3,
	levels: [1, 0, 0],
	weakest: true
};

function grassNear(radius: number): { pos: GridPos; tile: Tile }[] {
	const out: { pos: GridPos; tile: Tile }[] = [];
	for (let y = spawn.y - radius; y <= spawn.y + radius; y++)
		for (let x = spawn.x - radius; x <= spawn.x + radius; x++) {
			const tile = tileAtWorld(SEED, x, y);
			if (tile.kind === 'tallgrass' && Math.hypot(x - spawn.x, y - spawn.y) <= radius)
				out.push({ pos: { x, y }, tile });
		}
	return out;
}

/** Tokens per battle for a kid with this party, meeting what comes out on these tiles. */
function tokensPerBattle(
	party: readonly string[],
	sites: { pos: GridPos; tile: Tile }[],
	kid: Kid
) {
	const team: AnimalInstance[] = party.map((s, i) => ({
		id: `p${i}`,
		speciesId: s,
		hp: getAnimal(s).maxHp
	}));
	const leadTier = getAnimal(party[0]!).tier as Tier;
	const rng = new Rng(hashInts(SEED, hashString(party.join()), kid.catchWant * 100));
	let tokens = 0;
	let battles = 0;
	for (let b = 0; b < BATTLES; b++) {
		const site = sites[rng.int(0, sites.length - 1)]!;
		const d = Math.hypot(site.pos.x - spawn.x, site.pos.y - spawn.y);
		const table = encounterTable(site.tile.biome, d, leadTier);
		if (table.length === 0) continue;
		let r = rng.next();
		const entry = table.find((e) => (r -= e.weight) < 0) ?? table[table.length - 1]!;
		const wild = { id: 'wild', speciesId: entry.species.id, hp: entry.species.maxHp };
		const want = rng.chance(kid.catchWant);
		let state = startBattle(team, wild);
		for (let i = 0; i < 400 && state.phase.kind !== 'ended'; i++) {
			const phase = state.phase;
			let intent: BattleIntent;
			if (phase.kind === 'solving') {
				const a = phase.puzzle.answer;
				intent = { type: 'answer', input: String(rng.chance(kid.accuracy) ? a : a + 1) };
			} else if (phase.kind === 'choose-animal') {
				intent = { type: 'switch', partyIndex: state.party.findIndex((a) => a.hp > 0) };
			} else {
				const hp = state.opponent.hp / getAnimal(state.opponent.speciesId).maxHp;
				const attacks = getAnimal(state.party[state.active]!.speciesId).attacks.length;
				const roll = rng.next();
				const level = (
					roll < kid.levels[0] ? 1 : roll < kid.levels[0] + kid.levels[1] ? 2 : 3
				) as AttackLevel;
				intent =
					want && hp <= kid.throwAt
						? { type: 'throw-leash' }
						: { type: 'attack', attackIndex: kid.weakest ? 1 : rng.int(1, attacks), level };
			}
			state = applyBattleIntent(state, intent, hashInts(b, 7)).state;
		}
		battles++;
		if (state.phase.kind === 'ended' && state.phase.outcome === 'caught') {
			tokens += tokensForTier(getAnimal(wild.speciesId).tier);
		}
	}
	return tokens / battles;
}

describe('tokens against the battles that earn them', () => {
	it('farming the smallest animals is never the fastest way to tokens, nor absurdly faster than playing', () => {
		const near = grassNear(30);
		const reed = [{ pos: { x: -3, y: 6 }, tile: tileAtWorld(SEED, -3, 6) }];
		expect(reed[0]!.tile.kind).toBe('tallgrass');
		const starter = ['squirrel', 'rabbit', 'frog'];
		const fox = ['fox', 'otter', 'rabbit'];
		const farm = tokensPerBattle(starter, reed, FARMER);
		const ordinary = tokensPerBattle(starter, near, ORDINARY);
		const foxOrdinary = tokensPerBattle(fox, near, ORDINARY);
		const foxFarm = tokensPerBattle(fox, near, FARMER);
		if (process.env.SIM) {
			console.log(
				[
					'tokens per battle, every catch going home:',
					`  starter farming the reed by the start:   ${farm.toFixed(2)}`,
					`  starter, ordinary play near home:        ${ordinary.toFixed(2)}`,
					`  fox in front, ordinary play near home:   ${foxOrdinary.toFixed(2)}`,
					`  fox in front, farming near home:         ${foxFarm.toFixed(2)}`
				].join('\n')
			);
		}
		// The same farming with a bigger animal in front earns more: the smallest animals are
		// never the fastest way to tokens.
		expect(farm).toBeLessThan(foxFarm);
		// A bigger animal in front, played the ordinary way, earns more than the starter does,
		// and about what the tier-1 farm does. Since the bell, a fox meets a small animal about
		// 1 battle in 3 near home, so its ordinary play is no longer ahead of the farm by the
		// battle (1.98 tokens to 2.04 over 30,000 battles each; by the minute, 1.42 to 1.40).
		expect(foxOrdinary).toBeGreaterThan(1.5 * ordinary);
		expect(foxOrdinary).toBeGreaterThan(0.9 * farm);
		// And the farm is a few times ordinary play with the starter at most, never ten.
		expect(farm).toBeLessThan(3 * ordinary);
		expect(ordinary).toBeGreaterThan(0);
		// About 0.4 s alone (6,000 whole battles); twice that with browsers drawing beside it.
	}, 30_000);
});
