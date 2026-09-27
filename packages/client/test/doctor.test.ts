import type { Tile } from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
	ARM_LENGTH,
	GREET_FAR,
	GREET_NEAR,
	GREET_SECONDS,
	Greetings,
	REST_YAW,
	type WitchDoctor
} from '../src/render/doctor';
import { buildTileProps, doctorsIn } from '../src/render/tiles';

/**
 * The witch doctor at every tent (`doctor.ts`): alive, greeting the trainer
 * once as they come near, and keeping close to his tent whatever he does,
 * so nobody on the tiles round it, or walking past, stands in him, his staff
 * or his pot. What frames can't show for sure: every moment of the idle and
 * of a greeting, from every side, with and without reduced motion.
 */

const TENT: Tile = { kind: 'tent', biome: 'meadow', height: 0 };
const AT = { x: 10, z: 20 };

/** A tent at `AT` as its chunk draws it, and its doctor. */
function camp(): { group: THREE.Group; doctor: WitchDoctor } {
	const group = buildTileProps(TENT, AT.x, AT.z);
	const doctors = doctorsIn(group);
	expect(doctors).toHaveLength(1);
	return { group, doctor: doctors[0]! };
}

/** The trainer on each tile round the tent, and further out. */
const AROUND = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
	[1, 1],
	[-1, 1],
	[1, -1],
	[-1, -1],
	[0, 2],
	[2, 1]
].map(([dx, dz]) => ({ x: AT.x + dx!, z: AT.z + dz! }));

/** Where a named part of the doctor is in the world, or a point in its own frame. */
function whereIs(doctor: WitchDoctor, name: string, local = new THREE.Vector3()): THREE.Vector3 {
	const part = doctor.figure.getObjectByName(name)!;
	part.updateWorldMatrix(true, false);
	return part.localToWorld(local.clone());
}

/** His free arm's shoulder, and his hand at the end of it. */
const shoulder = (doctor: WitchDoctor) => whereIs(doctor, 'waving');
const hand = (doctor: WitchDoctor) =>
	whereIs(doctor, 'waving', new THREE.Vector3(0, -ARM_LENGTH, 0));

/** Every moment of a few seconds: `frames` samples, 1/20 s apart, from `from`. */
const seconds = (from: number, frames: number) =>
	Array.from({ length: frames }, (_, i) => from + i / 20);

describe('the witch doctor', () => {
	it('keeps the tent, himself and his pot where no trainer beside the tent reaches, idling and greeting from every side', () => {
		// A trainer on a tile beside the tent, standing or walking past, keeps at least 0.77
		// from the tent's middle (their cap's peak, 0.23 out from their own middle, the
		// furthest they reach): so the tent's tile and a little over its edges is the doctor's.
		const { group, doctor } = camp();
		const REACH = 0.6;
		const tile = new THREE.Box3(
			new THREE.Vector3(AT.x - REACH, -Infinity, AT.z - REACH),
			new THREE.Vector3(AT.x + REACH, Infinity, AT.z + REACH)
		);
		const box = new THREE.Box3();
		const outside: string[] = [];
		const check = (what: string) => {
			group.updateMatrixWorld(true);
			group.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				box.setFromObject(o, true);
				if (!tile.containsBox(box)) {
					outside.push(
						`${what}: ${o.parent?.name || 'part'} x ${box.min.x.toFixed(2)}…${box.max.x.toFixed(2)}, z ${box.min.z.toFixed(2)}…${box.max.z.toFixed(2)}`
					);
				}
			});
		};
		for (const calm of [false, true]) {
			for (const t of seconds(100, 140)) {
				doctor.animate(t, null, null, calm);
				check(`idle at ${t.toFixed(2)} s${calm ? ', calm' : ''}`);
			}
			for (const trainer of AROUND) {
				// Long enough to turn all the way to them, and through the whole greeting.
				for (const t of seconds(200, Math.ceil(GREET_SECONDS * 20) + 20)) {
					doctor.animate(t, t - 200, trainer, calm);
					check(
						`greeting (${trainer.x - AT.x}, ${trainer.z - AT.z}) at ${(t - 200).toFixed(2)} s${calm ? ', calm' : ''}`
					);
				}
			}
		}
		expect(outside.slice(0, 8)).toEqual([]);
	});

	it('is alive: his hat’s tip swings, his staff is lifted and tapped down, he looks about, and bubbles rise in the pot', () => {
		const range = (calm: boolean) => {
			const { doctor } = camp();
			const tips: THREE.Vector3[] = [];
			const staffs: number[] = [];
			const yaws: number[] = [];
			const bubbles: number[] = [];
			for (const t of seconds(50, 200)) {
				doctor.animate(t, null, null, calm);
				tips.push(whereIs(doctor, 'tip', new THREE.Vector3(0, 0.2, 0)));
				staffs.push(doctor.figure.getObjectByName('staff')!.position.y);
				yaws.push(doctor.figure.rotation.y);
				bubbles.push(doctor.pot.children.at(-1)!.position.y);
			}
			const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
			return {
				tip: Math.max(spread(tips.map((p) => p.x)), spread(tips.map((p) => p.z))),
				staff: Math.max(...staffs),
				grounded: Math.min(...staffs),
				look: spread(yaws),
				bubble: spread(bubbles)
			};
		};
		const lively = range(false);
		const calm = range(true);
		expect(lively.tip).toBeGreaterThan(0.04);
		expect(lively.staff).toBeGreaterThan(0.08);
		expect(lively.grounded).toBe(0);
		expect(lively.look).toBeGreaterThan(0.3);
		expect(lively.bubble).toBeGreaterThan(0.1);
		// With reduced motion every movement is smaller, and none stops.
		for (const key of ['tip', 'staff', 'look', 'bubble'] as const) {
			expect(calm[key], key).toBeGreaterThan(0);
			expect(calm[key], key).toBeLessThan(lively[key] * 0.75);
		}
	});

	it('greets with a hop and a wave, the hand up by his face, with reduced motion too, then rests', () => {
		for (const calm of [false, true]) {
			const { doctor } = camp();
			const trainer = { x: AT.x, z: AT.z + 1 };
			doctor.animate(300, null, null, calm);
			const standing = doctor.figure.getObjectByName('rig')!.position.y;
			doctor.animate(300 + 0.18, 0.18, trainer, calm);
			expect(doctor.figure.getObjectByName('rig')!.position.y).toBeGreaterThan(
				standing + (calm ? 0.02 : 0.08)
			);
			for (const g of [0.6, 0.9, 1.2, 1.5]) {
				doctor.animate(300 + g, g, trainer, calm);
				const above = hand(doctor).y - shoulder(doctor).y;
				expect(above, `${g} s${calm ? ', calm' : ''}`).toBeGreaterThan(ARM_LENGTH * 0.5);
			}
			// The wave swings: the hand is somewhere else a quarter of a wave later.
			doctor.animate(301, 1, trainer, calm);
			const one = hand(doctor);
			doctor.animate(301.11, 1.11, trainer, calm);
			expect(hand(doctor).distanceTo(one)).toBeGreaterThan(calm ? 0.02 : 0.05);
			// Over: the arm is down by his side again, the feet on the ground.
			doctor.animate(300 + GREET_SECONDS + 0.05, GREET_SECONDS + 0.05, trainer, calm);
			expect(shoulder(doctor).y - hand(doctor).y).toBeGreaterThan(ARM_LENGTH * 0.9);
			expect(doctor.figure.getObjectByName('rig')!.position.y).toBe(0);
		}
	});

	it('turns to a trainer beside his tent, as far as he can, and not to one behind it', () => {
		const settle = (trainer: { x: number; z: number } | null) => {
			const { doctor } = camp();
			for (const t of seconds(400, 40))
				doctor.animate(t, trainer ? t - 400 + GREET_SECONDS : null, trainer, false);
			return doctor.figure.rotation.y;
		};
		const facing = (trainer: { x: number; z: number }, from: { x: number; z: number }) =>
			Math.atan2(trainer.x - from.x, trainer.z - from.z);
		const { doctor } = camp();
		const south = { x: AT.x, z: AT.z + 1 };
		expect(settle(south)).toBeCloseTo(facing(south, doctor), 1);
		// East: round towards them, as far as he turns that way.
		const east = settle({ x: AT.x + 1, z: AT.z });
		expect(east).toBeGreaterThan(REST_YAW + 0.4);
		expect(east).toBeLessThan(facing({ x: AT.x + 1, z: AT.z }, doctor));
		// North and west, the tent is between them: he stays as he was, looking about.
		for (const behind of [
			{ x: AT.x, z: AT.z - 1 },
			{ x: AT.x - 1, z: AT.z }
		]) {
			expect(Math.abs(settle(behind) - REST_YAW)).toBeLessThan(0.3);
		}
	});
});

describe('greetings', () => {
	const doctor = { x: 0, z: 0 };
	const frame = 1 / 60;

	it('start the frame the trainer comes within reach, once, until they have walked away', () => {
		const greetings = new Greetings();
		let t = 10;
		const at = (x: number) => {
			t += frame;
			const g = greetings.check(doctor.x, doctor.z, { x, z: 0 }, t);
			greetings.sweep(t);
			return g;
		};
		// Walking in from five tiles out: nothing, until the trainer is within reach.
		let x = 5;
		for (; x > GREET_NEAR; x -= 0.05) expect(at(x)).toBeNull();
		expect(at(x)).toBe(0);
		// Then the seconds count up, however they wander about near him.
		let last = 0;
		for (let i = 0; i < 600; i++) {
			const g = at(1 + 1.4 * Math.abs(Math.sin(i / 40)))!;
			expect(g).toBeGreaterThan(last);
			last = g;
		}
		expect(last).toBeGreaterThan(GREET_SECONDS);
		// Out past GREET_FAR it is over, and it plays again when they come back.
		for (x = 1; x <= GREET_FAR; x += 0.05) expect(at(x)).not.toBeNull();
		expect(at(GREET_FAR + 0.01)).toBeNull();
		expect(at(GREET_NEAR + 0.3)).toBeNull();
		expect(at(GREET_NEAR - 0.1)).toBe(0);
	});

	it('forget a doctor nobody asked about in a frame: his chunk went, or the world did', () => {
		const greetings = new Greetings();
		expect(greetings.check(0, 0, { x: 1, z: 0 }, 1)).toBe(0);
		greetings.sweep(1);
		expect(greetings.check(0, 0, { x: 1, z: 0 }, 2)).toBe(1);
		greetings.sweep(2);
		// A frame in which only another doctor is drawn.
		expect(greetings.check(50, 50, { x: 1, z: 0 }, 3)).toBeNull();
		greetings.sweep(3);
		expect(greetings.check(0, 0, { x: 1, z: 0 }, 4)).toBe(0);
		greetings.clear();
		expect(greetings.check(0, 0, { x: 1, z: 0 }, 5)).toBe(0);
	});
});
