import type { Busy } from '../net/protocol.js';
import { tilesApart } from '../net/nearby.js';
import { clearedTile } from '../world/edits.js';
import { tileAtWorld } from '../world/generate.js';
import { isWater, type GridPos } from '../world/types.js';

/**
 * Who may challenge whom to a friendly match ([[PRODUCT]] §4 "Friendly
 * matches"), by where the two stand and what they are doing: the rule the
 * page asks before it shows "Challenge Ada", and the server asks again, with
 * the positions the two pages last reported, before it sends the invite and
 * again before the match starts. Both players in one world, neither in a
 * match already nor asked or asking, and each bringing a team, are the
 * server's to check: a page does not know them all.
 *
 * Pure: the ground under each player is read from the seeded world, as
 * their own clearing would leave the tile they stand on (`clearedTile`). A
 * player stands on a tile that was a tree, a rock or an ice block only once
 * they cleared it themselves, and what clearing leaves is the seeded tile's
 * to say: a tree or a rock is ground, an ice block what it stood on. So a
 * block broken out on the water is water here too, for the kid in the boat on
 * it, whoever else still sees the block (cleared tiles are each player's own:
 * [[DECISIONS]] § Gameplay), and the page and the server judge it alike
 * without knowing anyone's clearings.
 */

/** Two players this many tiles apart or nearer, the long way round a square (`tilesApart`), can play. */
export const CHALLENGE_REACH = 2;

/** A player as a challenge sees them: where they stand, and what they are busy with. */
export interface ChallengeSpot extends GridPos {
	busy: Busy;
}

/**
 * Why `me` can't challenge `them` now:
 * - `busy`: I am not exploring;
 * - `water`: I am out on the water, and a match is fought on land;
 * - `far`: they are more than `CHALLENGE_REACH` tiles away;
 * - `they-busy`: they are not exploring (a battle, the doctor, the menu, a match);
 * - `they-water`: they are out on the water.
 */
export type ChallengeRefusal = 'busy' | 'water' | 'far' | 'they-busy' | 'they-water';

/**
 * Whether `me` may challenge `them` to a friendly match now, in the world of
 * `seed`: null when they may, else the first reason they may not, in the
 * order of `ChallengeRefusal`. The same rule holds both ways, so it also says
 * whether `them` may accept.
 */
export function challengeRefusal(
	seed: number,
	me: ChallengeSpot,
	them: ChallengeSpot
): ChallengeRefusal | null {
	if (me.busy !== 'explore') return 'busy';
	if (onWater(seed, me)) return 'water';
	if (tilesApart(me, them) > CHALLENGE_REACH) return 'far';
	if (them.busy !== 'explore') return 'they-busy';
	if (onWater(seed, them)) return 'they-water';
	return null;
}

function onWater(seed: number, at: GridPos): boolean {
	return isWater(clearedTile(tileAtWorld(seed, at.x, at.y)).kind);
}
