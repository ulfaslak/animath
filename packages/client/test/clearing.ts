import {
	isWalkable,
	newGame,
	spawnPoint,
	step,
	tileAtWorld,
	type Direction,
	type GridPos,
	type SavedGame,
	type TileKind
} from '@mathgame/engine';
import { WORLD_SEED } from '../src/authority/local';

/**
 * Where the client tests chop and break: a tile of a kind, the nearest one to
 * the spawn with ground to stand on beside it, and the way to face it. Found in
 * the prototype world, never written down, so a change to the world moves the
 * test with it.
 */
export interface Beside {
	target: GridPos;
	stand: GridPos;
	facing: Direction;
}

const BACK: Record<Direction, Direction> = { up: 'down', down: 'up', left: 'right', right: 'left' };

export function besideA(kind: TileKind, where: (height: number) => boolean = () => true): Beside {
	const home = spawnPoint(WORLD_SEED);
	for (let r = 1; r < 200; r++) {
		for (let y = home.y - r; y <= home.y + r; y++) {
			for (let x = home.x - r; x <= home.x + r; x++) {
				if (Math.max(Math.abs(x - home.x), Math.abs(y - home.y)) !== r) continue;
				const tile = tileAtWorld(WORLD_SEED, x, y);
				if (tile.kind !== kind || !where(tile.height)) continue;
				for (const facing of ['right', 'left', 'up', 'down'] as const) {
					const stand = step({ x, y }, BACK[facing]);
					if (!isWalkable(tileAtWorld(WORLD_SEED, stand.x, stand.y).kind)) continue;
					return { target: { x, y }, stand, facing };
				}
			}
		}
	}
	throw new Error(`no ${kind} with ground beside it near the spawn`);
}

/** A game standing beside `spot`, facing it, owning `items`. */
export function gameBeside(spot: Beside, items: string[]): SavedGame {
	return { ...newGame(WORLD_SEED), pos: { ...spot.stand }, facing: spot.facing, items };
}
