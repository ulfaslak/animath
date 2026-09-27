import type {
	Busy,
	Direction,
	FightEvent,
	FightMessage,
	FightView,
	GridPos
} from '@mathgame/engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { WORLD_SEED } from '../src/authority/local';
import { CHEER_SECONDS, OtherPlayers } from '../src/render/others';
import {
	END_SECONDS,
	FIGHT_GEOMETRIES,
	FigurePool,
	GRACE_SECONDS,
	LEASH_FLIGHT_SECONDS,
	MAX_FIGHTS,
	POP_SECONDS,
	WatchedFights
} from '../src/render/fights';
import { Poofs } from '../src/render/poof';
import { FACING_ANGLE } from '../src/render/trainer';

// Battles seen from outside ([[UI_SPEC]] § Explore mode, "Playing together"),
// drawn without WebGL: where the animals stand, what each event does to them
// and to the page's marks (thought bubbles, HP bars, damage numbers), when a
// scene clears, and that it leaves nothing behind ([[INVARIANTS]] § Rendering).

/** In World 1 the reed left of the start, with sand two tiles further left: Ada meets a rat there, facing left. */
const REED: GridPos = { x: -3, y: 6 };
/** Two meadow tiles side by side, with meadow in front of them: a friendly match's place. */
const MATCH_A: GridPos = { x: 2, y: 9 };
const MATCH_B: GridPos = { x: 3, y: 9 };

function setup() {
	const scene = new THREE.Scene();
	const figures = new THREE.Group();
	scene.add(figures);
	const host = {
		addFigure: (f: THREE.Group) => figures.add(f),
		removeFigure: (f: THREE.Group) => figures.remove(f)
	};
	const poofs = new Poofs(scene);
	const others = new OtherPlayers(scene, host, poofs);
	others.setWorld(WORLD_SEED);
	others.setCentre(REED);
	const fights = new WatchedFights(scene, host, poofs, others);
	fights.setWorld(WORLD_SEED);
	fights.setCentre(REED);
	let now = 0;
	const frame = (dt = 1 / 30) => {
		now += dt;
		others.update(now, dt);
		fights.update(now, dt);
		poofs.update(now);
	};
	const frames = (seconds: number, each?: () => void) => {
		for (let t = 0; t < seconds; t += 1 / 30) {
			frame();
			each?.();
		}
	};
	const peer = (
		pid: string,
		at: GridPos,
		busy: Busy,
		facing: Direction = 'left',
		lead = 'squirrel'
	) =>
		others.seen({ t: 'peer', pid, name: pid, x: at.x, y: at.y, facing, lead, boat: false, busy });
	/** The animal figures standing in the world (a follower's included), by species. */
	const standing = () => figures.children.map((f) => f.name).sort();
	const figure = (species: string) =>
		figures.children.find((f) => f.name === species) as THREE.Group;
	const trainer = (pid: string) => scene.getObjectByName(`other:${pid}`) as THREE.Group;
	return { scene, figures, poofs, others, fights, frame, frames, peer, standing, figure, trainer };
}

const view = (patch: Partial<FightView> = {}): FightView => ({
	realm: 'land',
	a: { species: 'squirrel', nickname: 'Pip', hp: 20 },
	b: { species: 'brown-rat', hp: 22 },
	turn: 'a',
	puzzle: null,
	...patch
});
const fight = (
	patch: Partial<FightView> = {},
	events: FightEvent[] = [],
	pid = 'ada',
	vs: string | null = null
): FightMessage => ({
	t: 'fight',
	pid,
	vs,
	view: view(patch),
	events
});
const SUM = { kind: 'mul', numbers: [7, 8] } as const;

/** Ada in a battle on the reed, as Bo sees her: the scene laid out and every animal grown in. */
function adaInABattle() {
	const s = setup();
	s.peer('ada', REED, 'battle');
	s.frames(1);
	s.fights.show(fight());
	s.frames(1);
	return s;
}

describe('a wild battle seen from outside', () => {
	it('pops out beside its fighter: their animal between them and the wild one, facing it, and their lead no longer following', () => {
		const s = setup();
		// She stepped left onto the reed.
		s.peer('ada', REED, 'battle', 'left');
		s.frames(1);
		// Before the battle is heard of, her squirrel follows her.
		expect(s.standing()).toEqual(['squirrel']);
		s.fights.show(fight());
		s.frames(1);
		// Her follower shrank away; her squirrel and the rat stand in front of her.
		expect(s.standing()).toEqual(['brown-rat', 'squirrel']);
		const squirrel = s.figure('squirrel');
		const rat = s.figure('brown-rat');
		expect(squirrel.position.z).toBeCloseTo(REED.y);
		expect(rat.position.z).toBeCloseTo(REED.y);
		// On the sand to her left (the water is up and down of her): hers nearer, the rat further.
		expect(squirrel.position.x).toBeCloseTo(REED.x - 1.2);
		expect(rat.position.x).toBeCloseTo(REED.x - 2.45);
		expect(squirrel.rotation.y).toBeCloseTo(FACING_ANGLE.left);
		expect(rat.rotation.y).toBeCloseTo(FACING_ANGLE.right);
		// She turned to face it.
		expect(s.trainer('ada').rotation.y).toBeCloseTo(FACING_ANGLE.left);
		const marks = s.fights.marks();
		expect(marks.thoughts.get('ada')).toMatchObject({ puzzle: null, mood: null, beat: 0 });
		expect(
			marks.bars.map((b) => [b.animal.nickname ?? b.animal.species, b.animal.hp, b.maxHp])
		).toEqual([
			['Pip', 20, 20],
			['brown-rat', 22, 22]
		]);
		// A small animal is drawn bigger in a battle, so it reads from across the screen.
		expect(rat.scale.x).toBeGreaterThan(1);
	});

	it('lays the scene out across the screen when the way she faces goes up or down it, and away from the water', () => {
		// Facing up on the reed (the lake is up there): the scene goes right, the way across with room.
		const s = setup();
		s.peer('ada', REED, 'battle', 'up');
		s.frame();
		s.fights.show(fight());
		s.frames(1);
		expect(s.figure('squirrel').position.x).toBeCloseTo(REED.x + 1.2);
		expect(s.figure('brown-rat').position.x).toBeCloseTo(REED.x + 2.45);
		expect(s.trainer('ada').rotation.y).toBeCloseTo(FACING_ANGLE.right);
	});

	it("plays a step: the puzzle in the bubble, a right answer's pop, the damage floating up, and the fighter's double jump", () => {
		const s = adaInABattle();
		s.fights.show(fight({ puzzle: SUM }, [{ type: 'puzzle', side: 'a', puzzle: SUM }]));
		s.frames(0.5);
		expect(s.fights.marks().thoughts.get('ada')?.puzzle).toEqual(SUM);
		const feet = s.trainer('ada').position.y;
		s.fights.show(
			fight(
				{
					a: { species: 'squirrel', nickname: 'Pip', hp: 18 },
					b: { species: 'brown-rat', hp: 15 }
				},
				[
					{ type: 'judged', side: 'a', correct: true },
					{ type: 'hit', attacker: 'a', level: 3, damage: 7, hp: 15 },
					{ type: 'hit', attacker: 'b', level: 1, damage: 2, hp: 18 }
				]
			)
		);
		const moods = new Set<string>();
		const pops = new Map<number, number>();
		let highest = feet;
		s.frames(4, () => {
			const marks = s.fights.marks();
			moods.add(String(marks.thoughts.get('ada')?.mood));
			for (const pop of marks.pops) pops.set(pop.id, pop.damage);
			highest = Math.max(highest, s.trainer('ada').position.y);
		});
		expect(moods).toContain('right');
		expect([...pops.values()]).toEqual([7, 2]);
		// She jumped for joy when her squirrel's hit landed (only then: the rat's hit is no joy of hers).
		expect(highest - feet).toBeGreaterThan(0.15);
		const marks = s.fights.marks();
		expect(marks.thoughts.get('ada')).toMatchObject({ puzzle: null, mood: null, beat: 0 });
		expect(marks.bars.map((b) => b.animal.hp)).toEqual([18, 15]);
		// The numbers float up and are gone.
		s.frames(POP_SECONDS);
		expect(s.fights.marks().pops).toEqual([]);
	});

	it('shows a wrong answer as a wobble and a miss as a puff: no number, no jump', () => {
		const s = adaInABattle();
		s.fights.show(fight({ puzzle: SUM }, [{ type: 'puzzle', side: 'a', puzzle: SUM }]));
		s.frames(0.5);
		const feet = s.trainer('ada').position.y;
		const puffs = s.poofs.playing;
		s.fights.show(
			fight({}, [
				{ type: 'judged', side: 'a', correct: false },
				{ type: 'missed', attacker: 'a' }
			])
		);
		const moods = new Set<string>();
		let highest = feet;
		let pops = 0;
		let puffed = 0;
		s.frames(2, () => {
			moods.add(String(s.fights.marks().thoughts.get('ada')?.mood));
			pops += s.fights.marks().pops.length;
			puffed = Math.max(puffed, s.poofs.playing - puffs);
			highest = Math.max(highest, s.trainer('ada').position.y);
		});
		expect(moods).toContain('wrong');
		expect(pops).toBe(0);
		expect(puffed).toBeGreaterThan(0);
		expect(highest - feet).toBeLessThan(0.01);
	});

	it('throws the leash: a rope from her hand to the wild animal; one that holds sparkles, one shaken off drops away', () => {
		const loops = (scene: THREE.Scene) => {
			let n = 0;
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh && o.geometry === FIGHT_GEOMETRIES[0]) n++;
			});
			return n;
		};
		const stars = (scene: THREE.Scene) => {
			let n = 0;
			scene.traverse((o) => {
				if (o instanceof THREE.Mesh && o.geometry === FIGHT_GEOMETRIES[2]) n++;
			});
			return n;
		};
		const miss = adaInABattle();
		miss.fights.show(fight({}, [{ type: 'leash', caught: false }]));
		miss.frames(LEASH_FLIGHT_SECONDS / 2);
		expect(loops(miss.scene)).toBe(1);
		miss.frames(2);
		expect(loops(miss.scene)).toBe(0);
		expect(stars(miss.scene)).toBe(0);
		const caught = adaInABattle();
		caught.fights.show(fight({}, [{ type: 'leash', caught: true }]));
		let sparkled = 0;
		caught.frames(
			LEASH_FLIGHT_SECONDS + 0.4,
			() => (sparkled = Math.max(sparkled, stars(caught.scene)))
		);
		expect(sparkled).toBeGreaterThan(0);
		expect(loops(caught.scene)).toBe(1);
	});

	it('shows a switch as a poof and a new animal, and a knock-out as an animal lying down', () => {
		const s = adaInABattle();
		s.fights.show(
			fight({ a: { species: 'squirrel', nickname: 'Pip', hp: 0 } }, [
				{ type: 'hit', attacker: 'b', level: 2, damage: 20, hp: 0 },
				{ type: 'fainted', side: 'a' }
			])
		);
		s.frames(2.5);
		expect(s.figure('squirrel').userData.rest).toBeCloseTo(1);
		const puffs = s.poofs.playing;
		s.fights.show(
			fight({ a: { species: 'rabbit', hp: 22 } }, [
				{ type: 'switched', side: 'a', animal: { species: 'rabbit', hp: 22 } }
			])
		);
		let puffed = false;
		s.frames(1.5, () => (puffed ||= s.poofs.playing > puffs));
		expect(puffed).toBe(true);
		expect(s.standing()).toEqual(['brown-rat', 'rabbit']);
		expect(s.figure('rabbit').userData.rest).toBe(0);
	});

	it('shows the end, then clears: every figure given back, and her lead following her again', () => {
		const s = adaInABattle();
		s.fights.show(
			fight({ b: { species: 'brown-rat', hp: 0 }, turn: null }, [
				{ type: 'hit', attacker: 'a', level: 3, damage: 22, hp: 0 },
				{ type: 'fainted', side: 'b' },
				{ type: 'ended', winner: 'a', how: 'tired' }
			])
		);
		// The hit and the knock-out play first (about two seconds), then the end.
		s.frames(2.4);
		// The end showing: no bubble, the rat down, both still there.
		expect(s.fights.marks().thoughts.size).toBe(0);
		expect(s.figure('brown-rat').userData.rest).toBeCloseTo(1);
		s.frames(END_SECONDS + 1);
		expect(s.fights.count).toBe(0);
		expect(s.fights.figures.lent).toBe(0);
		// Her squirrel follows her again.
		expect(s.standing()).toEqual(['squirrel']);
		expect(s.fights.marks()).toEqual({ thoughts: new Map(), bars: [], pops: [] });
	});

	it('clears at once when its player takes off or is somewhere else, and a moment after they say they explore', () => {
		for (const busy of ['flight', 'doctor', 'menu'] as const) {
			const s = adaInABattle();
			s.peer('ada', REED, busy);
			s.frames(0.5);
			expect(s.fights.count, busy).toBe(0);
		}
		const moved = adaInABattle();
		// Somewhere else, her battle not over (a page that jumped): it is not where her battle was.
		moved.peer('ada', { x: 4, y: 7 }, 'battle');
		moved.frames(0.5);
		expect(moved.fights.count).toBe(0);
		// A lost battle takes her to the doctor's tent the moment it ends: its end still plays where it
		// was fought (her squirrel lying down, the rat hopping), without her, and then it clears.
		const lost = adaInABattle();
		lost.fights.show(
			fight({ a: { species: 'squirrel', nickname: 'Pip', hp: 0 }, turn: null }, [
				{ type: 'hit', attacker: 'b', level: 1, damage: 20, hp: 0 },
				{ type: 'fainted', side: 'a' },
				{ type: 'ended', winner: 'b', how: 'tired' }
			])
		);
		lost.frame();
		lost.peer('ada', { x: 4, y: 7 }, 'battle', 'up');
		lost.frames(2.5);
		expect(lost.fights.count).toBe(1);
		expect(lost.figure('squirrel').userData.rest).toBeCloseTo(1);
		// She stands as she likes at the tent: nothing of the battle holds her.
		expect(lost.trainer('ada').rotation.y).toBeCloseTo(FACING_ANGLE.up);
		lost.frames(END_SECONDS + 1);
		expect(lost.fights.count).toBe(0);
		const back = adaInABattle();
		back.peer('ada', REED, 'explore');
		back.frames(GRACE_SECONDS * 0.8);
		expect(back.fights.count).toBe(1);
		back.frames(GRACE_SECONDS);
		expect(back.fights.count).toBe(0);
		const gone = adaInABattle();
		gone.others.gone('ada');
		gone.frames(0.5);
		expect(gone.fights.count).toBe(0);
		expect(gone.fights.figures.lent).toBe(0);
	});

	it('shows someone who comes near mid-battle the battle as it stands, at once: both animals and the puzzle', () => {
		const s = setup();
		s.peer('ada', REED, 'battle');
		s.fights.show(fight({ puzzle: SUM, b: { species: 'brown-rat', hp: 9 } }));
		s.frame();
		expect(s.fights.marks().thoughts.get('ada')?.puzzle).toEqual(SUM);
		expect(s.standing()).toContain('brown-rat');
		expect(s.fights.marks().bars.map((b) => b.animal.hp)).toEqual([20, 9]);
	});

	it('never lays a battle out on water or trees, as far as the ground lets it: out at sea, only on the water', () => {
		// At sea: the otter and the crab swim, their lower parts under the surface.
		const s = setup();
		const sea = { x: -2, y: 1 };
		s.others.setCentre(sea);
		s.fights.setCentre(sea);
		s.peer('ada', sea, 'battle', 'up', 'otter');
		s.fights.show(
			fight({ realm: 'water', a: { species: 'otter', hp: 32 }, b: { species: 'crab', hp: 22 } })
		);
		s.frames(1);
		for (const species of ['otter', 'crab']) {
			const f = s.figure(species);
			expect(f.position.y, species).toBeLessThan(0.2);
		}
	});
});

describe('a friendly match seen from outside', () => {
	it("stands the two animals in front of its two players, facing each other, and puts the bubble over whoever's turn it is", () => {
		const s = setup();
		s.others.setCentre(MATCH_A);
		s.fights.setCentre(MATCH_A);
		s.peer('ada', MATCH_A, 'match', 'right');
		s.peer('bo', MATCH_B, 'match', 'left', 'rabbit');
		s.frames(1);
		s.fights.show(
			fight(
				{ a: { species: 'squirrel', hp: 20 }, b: { species: 'rabbit', hp: 22 } },
				[],
				'ada',
				'bo'
			)
		);
		s.frames(1);
		const squirrel = s.figures.children.find(
			(f) => f.name === 'squirrel' && f.position.z > MATCH_A.y + 0.5
		)!;
		const rabbit = s.figures.children.find(
			(f) => f.name === 'rabbit' && f.position.z > MATCH_A.y + 0.5
		)!;
		// In front of the two (towards the camera), Ada's on her side, Bo's on his, facing each other.
		expect(squirrel.position.x).toBeLessThan(rabbit.position.x);
		expect(squirrel.rotation.y).toBeCloseTo(FACING_ANGLE.right);
		expect(rabbit.rotation.y).toBeCloseTo(FACING_ANGLE.left);
		for (const pid of ['ada', 'bo'])
			expect(s.trainer(pid).rotation.y).toBeCloseTo(FACING_ANGLE.down);
		expect([...s.fights.marks().thoughts.keys()]).toEqual(['ada']);
		s.fights.show(
			fight(
				{
					a: { species: 'squirrel', hp: 20 },
					b: { species: 'rabbit', hp: 22 },
					turn: 'b',
					puzzle: SUM
				},
				[
					{ type: 'judged', side: 'a', correct: false },
					{ type: 'missed', attacker: 'a' },
					{ type: 'puzzle', side: 'b', puzzle: SUM }
				],
				'ada',
				'bo'
			)
		);
		s.frames(3);
		expect([...s.fights.marks().thoughts.keys()]).toEqual(['bo']);
		expect(s.fights.marks().thoughts.get('bo')).toMatchObject({ puzzle: SUM, mood: null, beat: 0 });
		// Bo's rabbit lands a hit: Bo jumps for joy.
		const feet = s.trainer('bo').position.y;
		let highest = feet;
		s.fights.show(
			fight(
				{ a: { species: 'squirrel', hp: 15 }, b: { species: 'rabbit', hp: 22 }, turn: 'a' },
				[
					{ type: 'judged', side: 'b', correct: true },
					{ type: 'hit', attacker: 'b', level: 2, damage: 5, hp: 15 }
				],
				'ada',
				'bo'
			)
		);
		s.frames(2 + CHEER_SECONDS, () => (highest = Math.max(highest, s.trainer('bo').position.y)));
		expect(highest - feet).toBeGreaterThan(0.15);
	});

	it('waits a moment for its players to say they are in it: a match starts on the server before its pages say so', () => {
		const s = setup();
		s.peer('ada', MATCH_A, 'explore', 'right');
		s.peer('bo', MATCH_B, 'explore', 'left', 'rabbit');
		s.fights.show(fight({}, [], 'ada', 'bo'));
		s.frames(GRACE_SECONDS * 0.5);
		s.peer('ada', MATCH_A, 'match', 'right');
		s.peer('bo', MATCH_B, 'match', 'left', 'rabbit');
		s.frames(GRACE_SECONDS * 2);
		expect(s.fights.count).toBe(1);
	});
});

describe('many battles at once', () => {
	it('draws at most MAX_FIGHTS, the nearest the middle of the screen, lends their figures from a pool, and gives them all back', () => {
		const s = setup();
		const spots: GridPos[] = [];
		for (let i = 0; i < 10; i++) spots.push({ x: -12 + 3 * i, y: 12 });
		spots.forEach((at, i) => s.peer(`p${i}`, at, 'battle', 'right'));
		s.others.setCentre({ x: -12, y: 12 });
		s.fights.setCentre({ x: -12, y: 12 });
		s.frames(0.5);
		spots.forEach((_, i) => s.fights.show(fight({}, [], `p${i}`)));
		s.frames(1);
		expect(s.fights.count).toBe(10);
		expect(s.fights.drawn).toBe(MAX_FIGHTS);
		expect(s.fights.figures.lent).toBe(2 * MAX_FIGHTS);
		// Walking along: the far ones come in as the near ones go out of reach.
		s.others.setCentre({ x: 15, y: 12 });
		s.fights.setCentre({ x: 15, y: 12 });
		s.frames(1);
		expect(s.fights.drawn).toBe(MAX_FIGHTS);
		spots.forEach((_, i) =>
			s.fights.show(fight({ turn: null }, [{ type: 'ended', winner: null, how: 'fled' }], `p${i}`))
		);
		s.frames(END_SECONDS + 1);
		expect(s.fights.count).toBe(0);
		expect(s.fights.figures.lent).toBe(0);
		expect(s.fights.figures.kept).toBeLessThanOrEqual(FigurePool.KEPT);
	});

	it('frees every figure it built once they leave for good: thirty battles come and go, and a new world frees the pool', () => {
		const s = setup();
		const live = new Set<THREE.BufferGeometry>();
		const look = () =>
			s.figures.traverse((o) => {
				if (!(o instanceof THREE.Mesh) || FIGHT_GEOMETRIES.includes(o.geometry)) return;
				const g = o.geometry as THREE.BufferGeometry;
				if (live.has(g)) return;
				live.add(g);
				g.addEventListener('dispose', () => live.delete(g));
			});
		const species = ['brown-rat', 'fox', 'bear', 'shrew', 'frog', 'deer'];
		for (let i = 0; i < 30; i++) {
			s.peer(`p${i}`, REED, 'battle');
			s.frame();
			s.fights.show(fight({ b: { species: species[i % species.length]!, hp: 1 } }, [], `p${i}`));
			s.frames(0.6, look);
			s.fights.show(fight({ turn: null }, [{ type: 'ended', winner: 'b', how: 'tired' }], `p${i}`));
			s.frames(END_SECONDS + 0.6, look);
			s.others.gone(`p${i}`);
			s.frames(1, look);
		}
		expect(s.fights.count).toBe(0);
		expect(s.fights.figures.kept).toBeLessThanOrEqual(FigurePool.KEPT);
		s.fights.setWorld(WORLD_SEED + 1);
		s.others.setWorld(WORLD_SEED + 1);
		expect(s.figures.children).toEqual([]);
		expect([...live].map((g) => g.type)).toEqual([]);
	});
});
