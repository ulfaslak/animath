import { ANIMALS, isWalkable, tileAtWorld, type GridPos } from '@mathgame/engine';
import type * as THREE from 'three';
import { buildAnimalMesh } from './animals';
import type { FigureHost } from './follower';
import { groundTop } from './tiles';

/**
 * The line-up in the world, put up once for the page (`main.ts`, on every
 * `welcome`). A `?zoo` page plays only throwaway games in the prototype world,
 * so a later `welcome` (Continue after the Start screen, a new game started
 * from the title) comes back to the line-up already standing by the spawn
 * tile. Put up again, a second line-up would stand by wherever the player
 * had walked to.
 */
export class Zoo {
	private standing = false;

	constructor(
		private readonly world: Pick<FigureHost, 'addFigure'>,
		private readonly tired: boolean
	) {}

	/** A game starts at `pos` in world `seed`. The first puts the line-up up by `pos`. */
	welcome(seed: number, pos: GridPos): void {
		if (this.standing) return;
		this.standing = true;
		for (const figure of buildZoo(seed, pos, this.tired)) this.world.addFigure(figure);
	}
}

/**
 * Verification line-up, reached with `?zoo` in the URL and never on the
 * normal path: one figure per species in catalog order, standing in a grid
 * round the spawn tile and facing the camera, so every species can be checked
 * in one screenshot at 1024×768. With `tired` (`?zoo=tired`) every one lies
 * down to rest, as a tired animal does in a battle. Documented in
 * AGENTS/DNA/CHEATSHEET.md.
 *
 * The grid is `zooColumns` wide, read left to right and then row by row down
 * the screen, its rows two tiles apart so a tall figure never hides the one
 * behind it, and the player's own row left empty between the middle two.
 */
export function buildZoo(seed: number, origin: GridPos, tired = false): THREE.Group[] {
	const spots = zooSpots(seed, origin, ANIMALS.length);
	return ANIMALS.map((spec, i) => {
		const { x, y } = spots[i]!;
		const figure = buildAnimalMesh(spec.id);
		figure.position.set(x, groundTop(tileAtWorld(seed, x, y)), y);
		figure.userData.idlePhase = i * 0.9;
		if (tired) figure.userData.rest = 1;
		return figure;
	});
}

/** How many figures a row of the grid holds, for `count` species: about twice as wide as tall. */
export function zooColumns(count: number): number {
	return Math.ceil(Math.sqrt(count * 2));
}

/** Tiles between two rows of the grid, top to bottom. */
const ROW_GAP = 2;

/**
 * Where each of `count` figures stands, in catalog order: columns one tile
 * apart, rows `ROW_GAP` apart, round `origin` with its own row left free, the
 * whole grid moved by at most two tiles either way to the place where the
 * most figures stand on ground a kid could walk on.
 */
export function zooSpots(seed: number, origin: GridPos, count: number): GridPos[] {
	const columns = zooColumns(count);
	const rows = Math.ceil(count / columns);
	const at = (dx: number, dy: number) =>
		Array.from({ length: count }, (_, i) => {
			const row = Math.floor(i / columns);
			// Rows above the player's, then below it: -3, -1, 1, 3 for four rows.
			const offset = (row - (rows - 1) / 2) * ROW_GAP;
			return {
				x: origin.x + dx - Math.floor(columns / 2) + (i % columns),
				y: origin.y + dy + Math.round(offset + (rows % 2 === 1 && offset >= 0 ? 1 : 0))
			};
		});
	let best = at(0, 0);
	let bestLand = -1;
	for (const dy of [0, -1, 1]) {
		for (const dx of [0, -1, 1, -2, 2]) {
			const spots = at(dx, dy);
			// Never on the player's own tile.
			if (spots.some((p) => p.x === origin.x && p.y === origin.y)) continue;
			const land = spots.filter((p) => isWalkable(tileAtWorld(seed, p.x, p.y).kind)).length;
			if (land > bestLand) {
				bestLand = land;
				best = spots;
			}
		}
	}
	return best;
}
