import { ANIMALS, getAnimal } from '@mathgame/engine';
import { parse, type AST } from 'svelte/compiler';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { touch } from '../src/input/touch.svelte';
import { motion } from '../src/motion';
import {
	BattleScene,
	battleBackdrop,
	battlePanelHeight,
	CLOUD_TOP,
	LEASH_FLIGHT_SECONDS,
	SEA_WATERLINE,
	SHORT_SCREEN,
	WILD_STATUS_BOX,
	WILD_STATUS_BOX_SHORT
} from '../src/render/battle-scene';
import { SWIM_DEPTH } from '../src/render/follower';
import { svelteSources } from './source';
import { turn } from './turn';

/**
 * The leash's loop stays in the picture and in plain view ([[DESIGN]] §
 * Aesthetic direction: a flourish never leaves the scene, and marks a moment
 * the screen already shows). Its throw used to arc a tile over the straight
 * line from the hand to the animal, and at every size the loop left through
 * the top edge, for every species (#54). Held under the top edge, it then
 * passed behind the wild animal's status box on its way up (#56). Seen
 * through the battle scene's own camera, and measured with three's
 * projection of every point of the loop, not the code's own geometry.
 */

/** The safe area's insets, as the scene reads them (`safe-area.ts`): each size sets its own. */
const inset = vi.hoisted(() => ({ top: 0, right: 0, bottom: 0, left: 0 }));
vi.mock('../src/safe-area', () => ({ safeArea: () => ({ ...inset }) }));

const FRAME = 1 / 60;
const NO_INSET = { top: 0, right: 0, bottom: 0, left: 0 };
/**
 * The supported sizes (a laptop, a tablet with a keyboard and without), and a
 * wide monitor; and tablets whose screen takes a safe area's insets: the home
 * indicator under the page (an iPad in Safari), and a notch at each side as
 * well (an iPhone's, sideways). Then phones held sideways, short screens
 * (`SHORT_SCREEN`) with the compact status box: an iPhone with its notch and
 * home indicator, an Android phone (touch, and with a keyboard) and a small
 * iPhone. Nothing draws over the page's top edge in landscape, so no size has
 * a top inset.
 */
const SIZES = [
	{ width: 1024, height: 768, touch: false, inset: NO_INSET },
	{ width: 1280, height: 720, touch: false, inset: NO_INSET },
	{ width: 1180, height: 820, touch: true, inset: NO_INSET },
	{ width: 1024, height: 768, touch: true, inset: NO_INSET },
	{ width: 2560, height: 1080, touch: false, inset: NO_INSET },
	{ width: 1024, height: 768, touch: true, inset: { top: 0, right: 0, bottom: 20, left: 0 } },
	{ width: 1180, height: 820, touch: true, inset: { top: 0, right: 59, bottom: 21, left: 59 } },
	{ width: 844, height: 390, touch: true, inset: { top: 0, right: 59, bottom: 21, left: 59 } },
	{ width: 740, height: 360, touch: true, inset: NO_INSET },
	{ width: 740, height: 360, touch: false, inset: NO_INSET },
	{ width: 667, height: 375, touch: true, inset: NO_INSET }
] as const;
/** The loop never comes nearer the top edge or the status box than this, in CSS pixels: it never touches them. */
const CLEAR = 8;
/** One scene for every battle, as in the game: `begin` dresses it for each throw. */
const scene = new BattleScene();

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * The wild animal's status box, in CSS pixels from the canvas's top left on
 * a screen with no safe-area insets (`inside` moves it in by them): where
 * `BattlePanel.svelte`'s CSS puts it and how wide, read from the component,
 * and 74 px tall, as Chrome draws `StatusBox`'s name and chunky HP bar at
 * every supported size, in both languages (no rule sets its height). On a
 * short screen, where the rules of its `(max-height: 560px)` query move it
 * and narrow it, 60 px tall, as Chrome draws it at 844×390, 740×360 and
 * 667×375, in both languages.
 */
const [STATUS_BOX, STATUS_BOX_SHORT]: Box[] = (() => {
	const source = svelteSources.get('src/ui/BattlePanel.svelte') ?? '';
	const children = parse(source, { modern: true }).css?.children ?? [];
	type Node = AST.CSS.Rule | AST.CSS.Atrule | AST.CSS.Declaration;
	const rulesOf = (nodes: readonly Node[]) =>
		nodes.filter((node): node is AST.CSS.Rule => node.type === 'Rule');
	const tall = rulesOf(children);
	const short = rulesOf(
		children
			.filter(
				(node): node is AST.CSS.Atrule =>
					node.type === 'Atrule' && node.name === 'media' && node.prelude === '(max-height: 560px)'
			)
			.flatMap((media) => media.block?.children ?? [])
	);
	// `280px`, or `calc(16px + var(--safe-left))`: 16 px in from the safe area's edge.
	const px = (rules: AST.CSS.Rule[], selector: string, property: string) => {
		const rule = rules.find((r) => source.slice(r.prelude.start, r.prelude.end) === selector);
		const value = rule?.block.children.find(
			(d): d is AST.CSS.Declaration => d.type === 'Declaration' && d.property === property
		)?.value;
		const found = value?.match(/^(?:calc\()?([\d.]+)px(?: \+ var\(--safe-[a-z]+\)\))?$/);
		if (!found) throw new Error(`${selector} has no ${property} in px`);
		return Number.parseFloat(found[1]!);
	};
	const left = px(tall, '.status.opponent', 'left');
	const top = px(tall, '.status.opponent', 'top');
	const shortTop = px(short, '.status.opponent', 'top');
	return [
		{ left, top, right: left + px(tall, '.status', 'width'), bottom: top + 74 },
		{ left, top: shortTop, right: left + px(short, '.status', 'width'), bottom: shortTop + 60 }
	];
})();

afterEach(() => {
	motion.reduced = false;
	touch.on = false;
	Object.assign(inset, NO_INSET);
});

/** The leash on screen: its loop, and the rope, which starts at the trainer's hand. */
function leashOf(scene: BattleScene): { loop: THREE.Mesh; rope: THREE.Mesh } | null {
	const loop = scene.scene.children.find(
		(o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.TorusGeometry
	);
	if (!loop) return null;
	const rope = scene.scene.children.find(
		(o): o is THREE.Mesh => o instanceof THREE.Mesh && o !== loop && o.material === loop.material
	);
	return rope ? { loop, rope } : null;
}

interface Point {
	x: number;
	y: number;
}

/** Where a point of the scene is on the canvas, in CSS pixels from its top left. */
function onCanvas(v: THREE.Vector3, size: (typeof SIZES)[number]): Point {
	const p = v.clone().project(scene.camera);
	return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
}

/** A point's way onto the canvas: see `loopOnCanvas`. */
const toCanvas = new THREE.Matrix4();
const point = new THREE.Vector3();

/**
 * How near every point of the loop comes to the canvas's top edge and to
 * `box`, in CSS pixels. Each point goes through three's projection as
 * `Vector3.project` does it, the camera's view and then its lens, with the
 * loop's own place folded into the same product: one product a point, not
 * three and a copy.
 */
function loopOnCanvas(
	loop: THREE.Mesh,
	size: (typeof SIZES)[number],
	box: Box
): { top: number; box: number } {
	scene.camera.updateMatrixWorld();
	loop.updateMatrixWorld(true);
	toCanvas
		.multiplyMatrices(scene.camera.projectionMatrix, scene.camera.matrixWorldInverse)
		.multiply(loop.matrixWorld);
	const points = loop.geometry.getAttribute('position');
	let top = Infinity;
	let near = Infinity;
	for (let i = 0; i < points.count; i++) {
		point.fromBufferAttribute(points, i).applyMatrix4(toCanvas);
		const p = { x: ((point.x + 1) / 2) * size.width, y: ((1 - point.y) / 2) * size.height };
		top = Math.min(top, p.y);
		near = Math.min(near, gap(p, box));
	}
	return { top, box: near };
}

/** The box as laid out from the safe area's top left: moved in by the insets. */
function inside(box: Box, by: { top: number; left: number }): Box {
	return {
		left: box.left + by.left,
		top: box.top + by.top,
		right: box.right + by.left,
		bottom: box.bottom + by.top
	};
}

/** How far a point is from the box, in CSS pixels: 0 on it or in it. */
function gap(p: Point, box: Box): number {
	return Math.hypot(
		Math.max(box.left - p.x, 0, p.x - box.right),
		Math.max(box.top - p.y, 0, p.y - box.bottom)
	);
}

/** How far the straight line from `a` to `b` passes from the box, in CSS pixels: 0 if it crosses it. */
function lineGap(a: Point, b: Point, box: Box): number {
	// The part of the line inside the box's edges, as a share of its length (Liang–Barsky).
	let from = 0;
	let to = 1;
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	for (const [p, q] of [
		[-dx, a.x - box.left],
		[dx, box.right - a.x],
		[-dy, a.y - box.top],
		[dy, box.bottom - a.y]
	] as const) {
		if (p === 0) {
			if (q < 0) from = Infinity;
		} else if (p < 0) from = Math.max(from, q / p);
		else to = Math.min(to, q / p);
	}
	if (from <= to) return 0;
	// Clear of it: the nearest is an end of the line, or a corner of the box.
	const toLine = (c: Point) => {
		const s = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / (dx * dx + dy * dy)));
		return Math.hypot(a.x + s * dx - c.x, a.y + s * dy - c.y);
	};
	return Math.min(
		gap(a, box),
		gap(b, box),
		...[box.left, box.right].flatMap((x) => [box.top, box.bottom].map((y) => toLine({ x, y })))
	);
}

interface Throw {
	/** The nearest the loop came to the top edge, in CSS pixels, and when (a moment of the leash's life). */
	top: number;
	topWhen: string;
	/** The nearest the loop came to the wild animal's status box, in CSS pixels, and when. */
	box: number;
	boxWhen: string;
	/** The nearest the rope came to it, and when: 0 if it crossed it. */
	rope: number;
	ropeWhen: string;
	/** The highest the loop's middle rose over the straight line from where it left the hand to where it landed, in tiles. */
	arc: number;
}

/**
 * Throw the leash at `species` a frame at a time, as the battle does: the
 * flight, then (as `ending` says) the loop holding while the animal cheers,
 * or popping off; or, `ending` null, the flight alone, which is all the arc
 * is measured on.
 */
function throwAt(
	size: (typeof SIZES)[number],
	species: string,
	ending: 'caught' | 'broke' | null
): Throw {
	touch.on = size.touch;
	Object.assign(inset, size.inset);
	scene.resize(size.width, size.height);
	const statusBox = inside(
		size.height <= SHORT_SCREEN ? STATUS_BOX_SHORT! : STATUS_BOX!,
		size.inset
	);
	// Where it is met: a sea animal out at sea, sunk in the water, facing one that swims.
	const atSea = !getAnimal(species).realms.includes('land');
	scene.begin(atSea ? 'sea' : 'meadow', atSea ? 'otter' : 'squirrel', species);
	let t = 0;
	scene.update(t);
	scene.throwLeash();
	// No time passes: the loop is where it leaves the hand.
	scene.update(t);
	const start = leashOf(scene)!.loop.position.clone();
	const flight: THREE.Vector3[] = [];
	const seen: Throw = {
		top: Infinity,
		topWhen: '',
		box: Infinity,
		boxWhen: '',
		rope: Infinity,
		ropeWhen: '',
		arc: 0
	};
	/** Looks at the leash as it is now: false once it has gone, which it never comes back from. */
	const look = (moment: string): boolean => {
		const leash = leashOf(scene);
		if (!leash) return false;
		if (moment === 'flying') flight.push(leash.loop.position.clone());
		if (!ending) return true;
		const when = `${moment} at ${t.toFixed(2)} s`;
		const loop = loopOnCanvas(leash.loop, size, statusBox);
		if (loop.top < seen.top) [seen.top, seen.topWhen] = [loop.top, when];
		if (loop.box < seen.box) [seen.box, seen.boxWhen] = [loop.box, when];
		// The rope runs straight from the hand to the loop's middle.
		const rope = lineGap(
			onCanvas(leash.rope.position, size),
			onCanvas(leash.loop.position, size),
			statusBox
		);
		if (rope < seen.rope) [seen.rope, seen.ropeWhen] = [rope, when];
		return true;
	};
	for (; t < LEASH_FLIGHT_SECONDS + 0.1;) {
		scene.update((t += FRAME));
		look('flying');
	}
	if (ending) {
		scene.leashResult(ending === 'caught');
		// A second: the pop is over in 0.3 s, the cheer's two hops in 0.9 s. A loop that
		// has popped off is gone, and nothing after it needs a look.
		for (let i = 0; i < 60; i++) {
			scene.update((t += FRAME));
			if (!look(ending === 'caught' ? 'riding the cheer' : 'popping off')) break;
		}
	}
	// The straight throw runs from where the loop left the hand to where it landed; x moves along it evenly.
	const landed = flight[flight.length - 1]!;
	for (const at of flight) {
		const along = (at.x - start.x) / (landed.x - start.x);
		seen.arc = Math.max(seen.arc, at.y - (start.y + (landed.y - start.y) * along));
	}
	scene.end();
	return seen;
}

/** A size as a failure names it. */
function sizeName(size: (typeof SIZES)[number]): string {
	const { top, right, bottom, left } = size.inset;
	const insets = size.inset === NO_INSET ? '' : `, insets ${top} ${right} ${bottom} ${left}`;
	return `${size.width}×${size.height}${size.touch ? ' (touch)' : ''}${insets}`;
}

interface Thrown {
	species: string;
	reduced: boolean;
	/** Whether the throw was looked at on the canvas, or flown for its arc alone. */
	looked: boolean;
	seen: Throw;
}

/** Every throw at a size, thrown once for the three tests that read it. */
const thrownAt = new Map<number, Promise<Thrown[]>>();

/**
 * Every throw at the `s`th size: at every species, ending both ways, looked
 * at every frame; and with reduced motion, looked at ending both ways for a
 * third of the species, taken in turn so each is so thrown at two or three
 * sizes, and flown for its arc alone for the rest. The lower throw of reduced
 * motion is never the tight one: with the 32 animals of #89 its loop kept
 * 66 px or more from the top edge, 53 from the status box and 40 from the
 * rope's crossing, where the full throw came within 10, 13 and 1; looking at
 * it for every species too doubled the sweep. The worker's loop turns after
 * each species, so it reads vitest's replies however long a loaded machine
 * takes over a size (`turn`).
 */
function throwsAt(s: number): Promise<Thrown[]> {
	let thrown = thrownAt.get(s);
	if (!thrown) thrownAt.set(s, (thrown = throwAll(s)));
	return thrown;
}

async function throwAll(s: number): Promise<Thrown[]> {
	const thrown: Thrown[] = [];
	const size = SIZES[s]!;
	for (const reduced of [false, true]) {
		for (const [i, { id }] of ANIMALS.entries()) {
			const looked = !reduced || (i + s) % 3 === 0;
			const endings = looked ? (['caught', 'broke'] as const) : [null];
			motion.reduced = reduced;
			for (const ending of endings)
				thrown.push({ species: id, reduced, looked, seen: throwAt(size, id, ending) });
			await turn();
		}
	}
	motion.reduced = false;
	touch.on = false;
	Object.assign(inset, NO_INSET);
	return thrown;
}

/** What `check` finds wrong with every throw looked at, at the `s`th size. */
async function everyThrow(s: number, check: (seen: Throw) => string | null): Promise<string[]> {
	const bad = (await throwsAt(s)).flatMap(({ species, reduced, looked, seen }) => {
		const wrong = looked ? check(seen) : null;
		return wrong ? [`${species}${reduced ? ', reduced motion' : ''}: ${wrong}`] : [];
	});
	// Both endings share the flight: one line for a flight that fails in both.
	return [...new Set(bad)];
}

describe('the leash', () => {
	it('knows where the wild animal’s status box is: its copy of the box covers the CSS’s', () => {
		expect(WILD_STATUS_BOX.right).toBe(STATUS_BOX!.right);
		expect(WILD_STATUS_BOX.bottom).toBeGreaterThanOrEqual(STATUS_BOX!.bottom);
		expect(WILD_STATUS_BOX_SHORT.right).toBe(STATUS_BOX_SHORT!.right);
		expect(WILD_STATUS_BOX_SHORT.bottom).toBeGreaterThanOrEqual(STATUS_BOX_SHORT!.bottom);
	});

	// One size at a time, so that no test holds its worker for the whole sweep.
	for (const [s, size] of SIZES.entries()) {
		describe(`at ${sizeName(size)}`, () => {
			it('keeps its loop in the picture for every species, with and without reduced motion', async () => {
				const bad = await everyThrow(s, ({ top, topWhen }) =>
					top < CLEAR ? `${top.toFixed(1)} px from the top edge, ${topWhen}` : null
				);
				expect(bad).toEqual([]);
				// Every species ending both ways, and with reduced motion looked at for a third of
				// them and flown for the rest, a frame at a time (about 135 throws with #89's 41
				// animals, 27 of them flights alone): 1.4 to 2.0 s alone at a load average of 12 to
				// 23, 1.7 to 7.8 s in the whole suite at 43 to 58, which scales to 20 s at 150. The
				// whole sweep in one test took 67 s in the whole suite at 165 with 32 animals.
			}, 90_000);

			it('never goes behind the wild animal’s status box: its loop keeps clear, and its rope never crosses it', async () => {
				const bad = await everyThrow(s, ({ box, boxWhen, rope, ropeWhen }) =>
					box < CLEAR
						? `the loop ${box > 0 ? `${box.toFixed(1)} px from` : 'behind'} the status box, ${boxWhen}`
						: rope <= 0
							? `the rope crosses the status box, ${ropeWhen}`
							: null
				);
				expect(bad).toEqual([]);
				// Reads the throws of the test above; run alone, it throws them itself, and takes as long.
			}, 90_000);

			it('still arcs, and arcs lower with reduced motion', async () => {
				const thrown = await throwsAt(s);
				const bad: string[] = [];
				for (const { id } of ANIMALS) {
					// Every throw's arc: both endings fly the same flight.
					const arcs = (reduced: boolean) =>
						thrown.filter((x) => x.species === id && x.reduced === reduced).map((x) => x.seen.arc);
					const full = Math.min(...arcs(false));
					const calm = Math.max(...arcs(true));
					// A fifth of a tile at least: the loop visibly lobs, however little sky there is.
					if (full < 0.2) bad.push(`${id}: arcs ${full.toFixed(2)} tiles`);
					if (!(Math.min(...arcs(true)) > 0 && calm < full * 0.5)) {
						bad.push(
							`${id}: arcs ${calm.toFixed(2)} tiles with reduced motion, ${full.toFixed(2)} without`
						);
					}
				}
				expect(bad).toEqual([]);
				// Reads the throws of the tests above; run alone, it throws them itself.
			}, 90_000);
		});
	}
});

/**
 * A phone held sideways is one line for the whole battle screen: the scene
 * frames itself and throws the leash by `SHORT_SCREEN` and
 * `battlePanelHeight`, the overlay lays itself out by its `max-height`
 * queries and `--battle-panel`, and a piece on the other side of a
 * different line would sit where the scene does not expect it.
 */
describe('a short screen', () => {
	const styles = Object.values(
		import.meta.glob('../src/styles.css', { query: '?raw', import: 'default', eager: true })
	)[0] as string;
	const PIECES = [
		'src/ui/BattlePanel.svelte',
		'src/ui/StatusBox.svelte',
		'src/ui/AttackTile.svelte',
		'src/ui/MoveButton.svelte',
		'src/ui/ActionPreview.svelte',
		'src/ui/HitBurst.svelte',
		'src/ui/MatchNotes.svelte',
		'src/ui/Celebration.svelte'
	];

	it('is SHORT_SCREEN in every short-screen query of the battle’s pieces and styles', () => {
		const lines = [
			...PIECES.map((file) => [file, svelteSources.get(file) ?? ''] as const),
			['src/styles.css', styles] as const
		].map(([file, text]) => ({
			file,
			heights: [...text.matchAll(/@media \(max-height: (\d+)px\)/g)].map((m) => Number(m[1]))
		}));
		const bad = lines.filter(
			({ heights }) => heights.length === 0 || heights.some((h) => h !== SHORT_SCREEN)
		);
		expect(bad).toEqual([]);
	});

	it('gives the panel the height the scene frames itself round, touch or not', () => {
		const found =
			/@media \(max-height: \d+px\)\s*\{[^}]*--battle-panel: calc\((\d+)px \+ var\(--safe-bottom\)\)/.exec(
				styles
			);
		const short = Number(found?.[1]);
		expect(short).toBeGreaterThan(0);
		for (const touchControls of [true, false]) {
			expect(battlePanelHeight(SHORT_SCREEN, touchControls, 0)).toBe(short);
			expect(battlePanelHeight(SHORT_SCREEN, touchControls, 21)).toBe(short + 21);
			expect(battlePanelHeight(SHORT_SCREEN + 1, touchControls, 0)).toBe(touchControls ? 364 : 260);
		}
	});
});

describe('out at sea', () => {
	it('every animal swims with the lower SWIM_DEPTH of its height under the surface, and stands on the ground on land', () => {
		const figures = () => (scene as unknown as { figures: Record<string, THREE.Group> }).figures;
		const bad: string[] = [];
		for (const { id } of ANIMALS) {
			for (const biome of ['sea', 'meadow'] as const) {
				scene.begin(biome, id, id);
				scene.update(0);
				for (const side of ['player', 'opponent'] as const) {
					const figure = figures()[side]!;
					figure.updateMatrixWorld(true);
					const box = new THREE.Box3().setFromObject(figure);
					const height = box.max.y - box.min.y;
					const under = biome === 'sea' ? (SEA_WATERLINE - box.min.y) / height : box.min.y;
					const want = biome === 'sea' ? SWIM_DEPTH : 0;
					if (Math.abs(under - want) > 0.03) bad.push(`${id} (${side}) in the ${biome}: ${under}`);
				}
			}
		}
		scene.end();
		expect(bad).toEqual([]);
	});

	it('a battle on the water is fought at sea, a fish hooked through the ice too, on the sea of its pole', () => {
		expect(battleBackdrop('water', 'sea')).toBe('sea');
		expect(battleBackdrop('water', 'arctic-ocean')).toBe('arctic-ocean');
		expect(battleBackdrop('water', 'southern-ocean')).toBe('southern-ocean');
		// The kid stands on the ice's edge, the hole's biome under them (#192's third wave).
		expect(battleBackdrop('water', 'arctic-ice')).toBe('arctic-ocean');
		expect(battleBackdrop('water', 'frozen-lake')).toBe('arctic-ocean');
		expect(battleBackdrop('water', 'antarctic-ice')).toBe('southern-ocean');
		expect(battleBackdrop('land', 'arctic-ice')).toBe('arctic-ice');
		expect(battleBackdrop('land', 'meadow')).toBe('meadow');
		expect(battleBackdrop('air', 'arctic-ocean')).toBe('sky');
	});
});

describe('the dust of a knock-out', () => {
	it('fades with a see-through material it hands on to the next dust, freeing none, and one of each kind stands hidden from the start', () => {
		// three.js frees a shader program with the last material that drew with it: a dust
		// that freed its own had the program compiled again at the next knock-out, a stall
		// as the animal lay down (#159).
		const battle = new BattleScene();
		const seeThrough = new Set<THREE.Material>();
		let freed = 0;
		const look = () =>
			battle.scene.traverse((o) => {
				if (!(o instanceof THREE.Mesh)) return;
				const material = o.material as THREE.Material;
				if (!material.transparent || seeThrough.has(material)) return;
				seeThrough.add(material);
				material.addEventListener('dispose', () => freed++);
			});
		look();
		// Before any battle, hidden: the renderer compiles them with the stage's first frame.
		const unseen = seeThrough.size;
		expect(unseen).toBeGreaterThanOrEqual(2);
		let t = 0;
		for (let i = 0; i < 12; i++) {
			// On the ground and in the sky by turns, a knock-out each, and now and then both at once.
			battle.begin(i % 2 === 0 ? 'meadow' : 'sky', i % 2 === 0 ? 'squirrel' : 'robin', 'rabbit');
			battle.faint('opponent');
			if (i % 3 === 0) battle.faint('player');
			for (let s = 0; s < 3; s += FRAME) {
				battle.update((t += FRAME));
				look();
			}
		}
		battle.end();
		expect(freed).toBe(0);
		// The hidden ones and those two dusts at once ever needed: none made per knock-out.
		expect(seeThrough.size).toBeLessThanOrEqual(unseen + 2);
	});
});

describe('the confetti of a catch', () => {
	it('lands on what is under it, the ground or up in the air a cloud, and falls on where no cloud is', () => {
		// Up in the air every piece used to stop at one height, the top of the clouds under the
		// birds, wherever it was: in mid-air, over the lower clouds or over nothing (#165).
		// Measured against the meshes as drawn, with a ray straight down, not the code's own sums.
		const battle = new BattleScene();
		battle.resize(1024, 768);
		const inside = battle as unknown as {
			confetti: { mesh: THREE.Mesh }[];
			backdrops: Map<string, THREE.Group>;
			ground: THREE.Mesh;
		};
		// Two tiles down at most: the dome of sky, far below the clouds, is nothing to land on.
		const ray = new THREE.Raycaster(undefined, undefined, 0, 2.5);
		const down = new THREE.Vector3(0, -1, 0);
		const bad: string[] = [];
		const landed = { sky: 0, meadow: 0 };
		let lowest = Infinity;
		let t = 0;
		for (const biome of ['sky', 'meadow'] as const) {
			for (const reduced of [false, true]) {
				motion.reduced = reduced;
				battle.begin(biome, 'robin', 'buzzard');
				// What a piece can land on: up in the air the clouds, on land the ground.
				const solid = biome === 'sky' ? inside.backdrops.get('sky')!.children : [inside.ground];
				// Where each mesh is in the world, as a frame drawn would put it.
				battle.scene.updateMatrixWorld(true);
				battle.update(t);
				battle.throwLeash();
				for (let s = 0; s < 1.4; s += FRAME) battle.update((t += FRAME));
				battle.leashResult(true);
				const last = new Map<THREE.Mesh, { y: number; dy: number }>();
				while (inside.confetti.length > 0) {
					battle.update((t += FRAME));
					for (const { mesh } of inside.confetti) {
						const y = mesh.position.y;
						const before = last.get(mesh);
						const dy = before ? y - before.y : 0;
						last.set(mesh, { y, dy });
						if (biome === 'sky') lowest = Math.min(lowest, y);
						// Only where a piece that was coming down stops: something must be under it.
						if (!before || before.dy >= 0 || dy < -1e-9) continue;
						ray.set(mesh.position.clone().setY(y + 0.5), down);
						const hit = ray.intersectObjects(solid, false)[0];
						const gap = hit ? hit.distance - 0.5 : Infinity;
						if (Math.abs(gap) <= 0.06) landed[biome]++;
						else {
							const where = mesh.position.toArray().map((n) => n.toFixed(2));
							bad.push(
								`${biome}${reduced ? ' (reduced motion)' : ''}: stopped at (${where.join(', ')}), ` +
									(hit ? `${gap.toFixed(2)} over what is under it` : 'over nothing')
							);
						}
					}
				}
			}
		}
		battle.end();
		expect(bad.slice(0, 5)).toEqual([]);
		expect(landed.sky).toBeGreaterThan(0);
		expect(landed.meadow).toBeGreaterThan(0);
		// And the pieces no cloud is under fall on, well below the clouds' tops.
		expect(lowest).toBeLessThan(CLOUD_TOP - 0.5);
	});
});
