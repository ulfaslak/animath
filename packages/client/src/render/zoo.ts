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
 * normal path: one figure per species in catalog order, standing in a row
 * near the spawn tile and facing the camera, so every species can be checked
 * in one screenshot. With `tired` (`?zoo=tired`) every one lies down to rest,
 * as a tired animal does in a battle. Documented in AGENTS/DNA/CHEATSHEET.md.
 */
export function buildZoo(seed: number, origin: GridPos, tired = false): THREE.Group[] {
	const half = Math.floor(ANIMALS.length / 2);
	const row = pickRow(seed, origin, half);
	return ANIMALS.map((spec, i) => {
		const x = origin.x - half + i;
		const figure = buildAnimalMesh(spec.id);
		figure.position.set(x, groundTop(tileAtWorld(seed, x, row)), row);
		figure.userData.idlePhase = i * 0.9;
		if (tired) figure.userData.rest = 1;
		return figure;
	});
}

/** Of the rows two or three tiles above or below the origin, the one with the most land. */
function pickRow(seed: number, origin: GridPos, half: number): number {
	let best = origin.y - 2;
	let bestLand = -1;
	for (const dy of [-2, 2, -3, 3]) {
		const y = origin.y + dy;
		let land = 0;
		for (let dx = -half; dx <= half; dx++) {
			if (isWalkable(tileAtWorld(seed, origin.x + dx, y).kind)) land++;
		}
		if (land > bestLand) {
			bestLand = land;
			best = y;
		}
	}
	return best;
}
