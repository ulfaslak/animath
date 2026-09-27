import { describe, expect, it } from 'vitest';
import { CHALLENGE_REACH, challengeRefusal, type ChallengeSpot } from '../src/match/challenge.js';
import { BUSY_STATES, type Busy } from '../src/net/protocol.js';
import { Rng } from '../src/rng.js';
import { tileAtWorld } from '../src/world/generate.js';
import { spawnPoint } from '../src/world/spawn.js';
import { worldSeed } from '../src/world/worlds.js';

/** Out on the water, read from the whole tile (deep water too), not the rule's own shortcut. */
function wet(seed: number, x: number, y: number): boolean {
	const kind = tileAtWorld(seed, x, y).kind;
	return kind === 'water' || kind === 'deepwater';
}

describe('who may challenge whom', () => {
	it('lets two players exploring on land within two tiles play, and says why not otherwise', () => {
		// Random pairs round each other in several worlds, on land and water, busy or
		// not, near and far: the refusal is the first that applies, in the rule's order.
		const bad: string[] = [];
		for (const world of [1, 2, 42, 777, 9999]) {
			const seed = worldSeed(world);
			const rng = new Rng(world);
			for (let i = 0; i < 3000; i++) {
				const x = rng.int(-60, 60);
				const y = rng.int(-60, 60);
				const busy = (): Busy => (rng.chance(0.75) ? 'explore' : rng.pick(BUSY_STATES));
				const me: ChallengeSpot = { x, y, busy: busy() };
				const them: ChallengeSpot = {
					x: x + rng.int(-4, 4),
					y: y + rng.int(-4, 4),
					busy: busy()
				};
				const apart = Math.max(Math.abs(me.x - them.x), Math.abs(me.y - them.y));
				const want =
					me.busy !== 'explore'
						? 'busy'
						: wet(seed, me.x, me.y)
							? 'water'
							: apart > CHALLENGE_REACH
								? 'far'
								: them.busy !== 'explore'
									? 'they-busy'
									: wet(seed, them.x, them.y)
										? 'they-water'
										: null;
				const got = challengeRefusal(seed, me, them);
				if (got !== want)
					bad.push(`world ${world} ${JSON.stringify([me, them])}: ${got} ≠ ${want}`);
				// Whether they may play holds both ways: the rule for accepting is the same.
				if ((got === null) !== (challengeRefusal(seed, them, me) === null)) {
					bad.push(`world ${world} ${JSON.stringify([me, them])}: one way only`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('reaches two tiles the long way round a square, diagonals too, and no further', () => {
		// Round the spawn of a few worlds: mostly land, where a match starts.
		let checked = 0;
		for (const world of [1, 2, 42]) {
			const seed = worldSeed(world);
			const spawn = spawnPoint(seed);
			const at = { ...spawn, busy: 'explore' as const };
			for (let dx = -3; dx <= 3; dx++) {
				for (let dy = -3; dy <= 3; dy++) {
					const x = spawn.x + dx;
					const y = spawn.y + dy;
					if (wet(seed, x, y)) continue;
					checked++;
					const far = Math.max(Math.abs(dx), Math.abs(dy)) > 2;
					expect(challengeRefusal(seed, at, { x, y, busy: 'explore' }), `${x}, ${y}`).toBe(
						far ? 'far' : null
					);
				}
			}
		}
		// Most of the 3 × 49 tiles are land: the loop really checked the reach.
		expect(checked).toBeGreaterThan(100);
	});
});
