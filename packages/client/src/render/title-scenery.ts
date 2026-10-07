import {
	WorldEdits,
	editedTileAt,
	getAnimal,
	isWalkable,
	isWater,
	tileAtWorld,
	type Direction,
	type GridPos,
	type TileKind
} from '@mathgame/engine';
import type * as THREE from 'three';
import { motion } from '../motion';
import { buildAnimalMesh, disposeFigure } from './animals';
import { SWIM_DEPTH } from './follower';
import { CAMERA_YAW, VIEW_HEIGHT_TILES, type GameRenderer } from './renderer';
import { StarterScene, type StarterRoom } from './starter-scene';
import { WATER_TOP, groundTop } from './tiles';

/**
 * What the title draws ([[UI_SPEC]] § Title). Behind the menu: the world
 * where the game stands (the saved spot, or the spawn tile for a new
 * player), the trainer, the team gathered round (the sea animals in the
 * water nearby, low in it as they swim, and left out with no water near; or,
 * with no game yet, the starters), all breathing, and the camera drifting
 * slowly over them (still
 * with reduced motion). It is the explore camera, only pointed a little
 * aside: the same angle, no zoom, no turn ([[DESIGN]] § Aesthetic
 * direction). Behind the starter screen: the
 * starter stage, drawn instead of the world. The animals are scenery, and go
 * when the game starts.
 */

/** How far the camera sways, in tiles, and how slowly (radians per second of frame time). */
const DRIFT = { x: 1.3, z: 0.8, rateX: 0.19, rateZ: 0.13 };
/** The world direction that is "right" on screen: from the explore camera's yaw. */
const SCREEN_RIGHT = { x: Math.cos(CAMERA_YAW), z: -Math.sin(CAMERA_YAW) };
/** The trainer stands this share of the screen's width right of centre, clear of the menu. */
const TRAINER_AT = 0.22;

/** What the title controller asks of the scenery; tests give it a stand-in. */
export interface TitleView3D {
	/**
	 * The menu's world: the trainer at `pos` in world `seed` (as `edits` leave
	 * it, the tiles the saved game cleared), facing `facing`, `species` round
	 * it, and the boat on their back, or under them out on the water, when the
	 * game has one.
	 */
	showWorld(
		seed: number,
		pos: GridPos,
		facing: Direction,
		species: readonly string[],
		edits?: WorldEdits,
		boat?: boolean
	): void;
	/** The starter stage, these species in a row, the first lit. */
	showStarters(species: readonly string[]): void;
	/** Light a starter. */
	select(index: number): void;
	/** A starter was picked: it hops for joy. */
	cheer(index: number): void;
	/** Where each starter's feet are on screen, as fractions of the canvas. */
	spots(): { x: number; y: number }[];
	/**
	 * The band of the screen the starters keep to, in CSS pixels from its
	 * top, as the starter screen measured it (null: anywhere). The row slides
	 * there, as `update` is called.
	 */
	setRoom(room: StarterRoom | null): void;
	/** Advance the drift, and the starters' slide into their room; `dt` is seconds of frame time. */
	update(dt: number): void;
	/** The game starts: back to the world, the title's animals gone. */
	hide(): void;
}

export class TitleScenery implements TitleView3D {
	private figures: THREE.Group[] = [];
	private center: GridPos = { x: 0, y: 0 };
	private t = 0;
	private stage: StarterScene | null = null;

	constructor(private renderer: GameRenderer) {}

	showWorld(
		seed: number,
		pos: GridPos,
		facing: Direction,
		species: readonly string[],
		edits: WorldEdits = WorldEdits.none,
		boat = false
	): void {
		this.clearWorld();
		this.renderer.setStage(null);
		this.center = { x: pos.x, y: pos.y };
		this.renderer.setWorld(seed, edits);
		this.renderer.setBoat(boat);
		this.renderer.setPlayer(pos, pos, 1, facing);
		this.renderer.ensureChunksAround(pos);
		// The land's animals on the ground round the trainer, the sea's in the water.
		const walks = (id: string) => getAnimal(id).realms.includes('land');
		const onLand = standingSpots(seed, edits, pos, species.filter(walks).length, isWalkable);
		const inWater = standingSpots(
			seed,
			edits,
			pos,
			species.filter((id) => !walks(id)).length,
			isWater
		);
		species.forEach((id, i) => {
			const spot = (walks(id) ? onLand : inWater).shift();
			if (!spot) return;
			const figure = buildAnimalMesh(id);
			const height = (figure.userData.restShape as { height: number }).height;
			const y = walks(id)
				? groundTop(tileAtWorld(seed, spot.x, spot.y))
				: WATER_TOP - height * SWIM_DEPTH;
			figure.position.set(spot.x, y, spot.y);
			// Facing the camera, each turned a little its own way, breathing out of step.
			figure.rotation.y = (i % 2 === 0 ? 0.35 : -0.35) * (1 + (i % 3) * 0.3);
			figure.userData.idlePhase = i * 0.9;
			this.renderer.addFigure(figure);
			this.figures.push(figure);
		});
		this.update(0);
	}

	showStarters(species: readonly string[]): void {
		this.stage ??= new StarterScene();
		this.stage.show(species);
		this.renderer.setStage(this.stage);
	}

	select(index: number): void {
		this.stage?.select(index);
	}

	cheer(index: number): void {
		this.stage?.cheer(index);
	}

	spots(): { x: number; y: number }[] {
		return this.stage?.spots() ?? [];
	}

	setRoom(room: StarterRoom | null): void {
		this.stage?.setRoom(room);
	}

	update(dt: number): void {
		this.stage?.slide(dt);
		// With reduced motion the camera holds still, wherever the drift had got to.
		if (!motion.reduced) this.t += dt;
		const aside = TRAINER_AT * VIEW_HEIGHT_TILES * this.renderer.aspect();
		const x = this.center.x - SCREEN_RIGHT.x * aside + DRIFT.x * Math.sin(this.t * DRIFT.rateX);
		const z = this.center.y - SCREEN_RIGHT.z * aside + DRIFT.z * Math.sin(this.t * DRIFT.rateZ);
		this.renderer.lookAt(x, z);
	}

	hide(): void {
		this.clearWorld();
		this.renderer.setStage(null);
	}

	private clearWorld(): void {
		for (const figure of this.figures) {
			this.renderer.removeFigure(figure);
			disposeFigure(figure);
		}
		this.figures = [];
	}
}

/**
 * The `count` tiles nearest `pos` (not `pos` itself) of a kind that `fits`
 * (ground to stand on, or water to swim in), nearest first, ties in a fixed
 * order, so the same game always gathers the same way. A tile the game
 * cleared is ground to stand on.
 */
function standingSpots(
	seed: number,
	edits: WorldEdits,
	pos: GridPos,
	count: number,
	fits: (kind: TileKind) => boolean
): GridPos[] {
	const found: GridPos[] = [];
	for (let r = 1; r <= 4 && found.length < count; r++) {
		const ring: GridPos[] = [];
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
				const spot = { x: pos.x + dx, y: pos.y + dy };
				if (fits(editedTileAt(seed, edits, spot.x, spot.y).kind)) ring.push(spot);
			}
		}
		// Nearest first within the ring; the scan order above settles ties.
		ring.sort((a, b) => dist(a, pos) - dist(b, pos));
		found.push(...ring);
	}
	return found.slice(0, count);
}

function dist(a: GridPos, b: GridPos): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
