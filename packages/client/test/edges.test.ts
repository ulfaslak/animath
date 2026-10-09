import { Rng } from '@mathgame/engine';
import { parse, type AST } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import {
	ARROW_CLEARANCE,
	GATHER_PX,
	MAX_NAMES,
	MAX_WAYS,
	NAME_CLEAR,
	NAME_GAP,
	SHORT_NAMES,
	aroundFrom,
	edgeTrack,
	gatherWays,
	namesSide,
	placeNames,
	spotOnTrack,
	type Heading,
	type Spot,
	type Track
} from '../src/presence/edges';
import type { Rect } from '../src/presence/labels';
import { SHORT_SCREEN } from '../src/short-screen';
import { svelteSources } from './source';

/**
 * The marks at the edge of the screen ([[UI_SPEC]] § Explore mode, "The
 * corners"): a friend's arrow is never under a piece of the HUD, the party
 * cards, the top right's pills or a touch control (#121: under the D-pad and
 * Talk on a tablet); friends who are one way share an arrow that names them
 * all (#140: two far off one way got the very same spot, one name); and
 * every way's names keep clear of the pieces and of each other.
 *
 * The layouts are the explore HUD as measured on the page, with every piece
 * on: three cards in the party, all four tools, the glider's Fly.
 */

const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

/** A tablet, 1024×768 with an iPad's home indicator (20 px), the touch controls on. */
const TABLET = {
	w: 1024,
	h: 768,
	insets: { ...NONE, bottom: 20 },
	pieces: [
		{ x0: 16, x1: 336, y0: 16, y1: 331 }, // the party column and its hint
		{ x0: 851, x1: 1008, y0: 16, y1: 272 }, // tokens, puzzles, four tools, the world
		{ x0: 925, x1: 1008, y0: 465, y1: 493 }, // the coordinates, over Fly
		{ x0: 416, x1: 608, y0: 690, y1: 732 }, // the message line
		{ x0: 20, x1: 212, y0: 536, y1: 728 }, // the D-pad
		{ x0: 904, x1: 1000, y0: 596, y1: 692 }, // Talk
		{ x0: 820, x1: 892, y0: 656, y1: 728 }, // Menu
		{ x0: 914, x1: 990, y0: 505, y1: 582 } // Fly
	]
};

/** A phone held sideways, 740×360, the touch controls on. */
const PHONE = {
	w: 740,
	h: 360,
	insets: NONE,
	pieces: [
		{ x0: 16, x1: 276, y0: 16, y1: 132 }, // the party column (its hint gives way)
		{ x0: 451, x1: 724, y0: 16, y1: 82 }, // two rows: the counts; the tools and the world
		{ x0: 535, x1: 618, y0: 142, y1: 170 }, // the coordinates, beside Fly
		{ x0: 266, x1: 474, y0: 300, y1: 344 }, // the message line
		{ x0: 20, x1: 212, y0: 148, y1: 340 }, // the D-pad
		{ x0: 620, x1: 716, y0: 208, y1: 304 }, // Talk
		{ x0: 536, x1: 608, y0: 268, y1: 340 }, // Menu
		{ x0: 630, x1: 706, y0: 117, y1: 194 } // Fly
	]
};

/** An iPhone held sideways, 844×390, its notch and home indicator. */
const NOTCHED = {
	w: 844,
	h: 390,
	insets: { top: 0, right: 59, bottom: 21, left: 59 },
	pieces: [
		{ x0: 75, x1: 335, y0: 16, y1: 132 },
		{ x0: 496, x1: 769, y0: 16, y1: 82 },
		{ x0: 580, x1: 663, y0: 151, y1: 179 },
		{ x0: 318, x1: 526, y0: 309, y1: 353 },
		{ x0: 79, x1: 271, y0: 157, y1: 349 },
		{ x0: 665, x1: 761, y0: 217, y1: 313 },
		{ x0: 581, x1: 653, y0: 277, y1: 349 },
		{ x0: 675, x1: 751, y0: 126, y1: 203 }
	]
};

const LAYOUTS = { tablet: TABLET, phone: PHONE, notched: NOTCHED };

/** How many rows of names a way takes at most on a layout: two on a phone. */
function rowsOn(layout: { h: number }): number {
	return layout.h <= SHORT_SCREEN ? SHORT_NAMES : MAX_NAMES;
}

/** The box an arrow's 30 px picture takes round its middle. */
function arrowBox(spot: { x: number; y: number }): Rect {
	return { x0: spot.x - 15, x1: spot.x + 15, y0: spot.y - 15, y1: spot.y + 15 };
}

/** How far apart two boxes are (0 when they touch or overlap): the larger of the two gaps. */
function apart(a: Rect, b: Rect): number {
	const gx = Math.max(a.x0 - b.x1, b.x0 - a.x1, 0);
	const gy = Math.max(a.y0 - b.y1, b.y0 - a.y1, 0);
	return Math.max(gx, gy);
}

/** A point `d` px from `me` the way `deg` points (degrees clockwise from up on the screen). */
function toward(me: { x: number; y: number }, deg: number, d = 5000): { x: number; y: number } {
	const a = (deg * Math.PI) / 180;
	return { x: me.x + Math.sin(a) * d, y: me.y - Math.cos(a) * d };
}

function strictlyInside(p: { x: number; y: number }, box: Rect): boolean {
	return p.x > box.x0 && p.x < box.x1 && p.y > box.y0 && p.y < box.y1;
}

/**
 * Everything a spot must be: on the line from the player the way it points,
 * inside the track, in no piece's grown box the player is not in (a pixel
 * of rounding aside), and as far out as it can go: a little further leaves
 * the track or walks into a piece.
 */
function checkSpot(
	me: { x: number; y: number },
	there: { x: number; y: number },
	track: Track,
	spot: Spot
): string[] {
	const bad: string[] = [];
	const cx = Math.min(track.right, Math.max(track.left, me.x));
	const cy = Math.min(track.bottom, Math.max(track.top, me.y));
	const [dx, dy] = [there.x - me.x, there.y - me.y];
	const length = Math.hypot(dx, dy);
	const cross = ((spot.x - cx) * dy - (spot.y - cy) * dx) / length;
	if (Math.abs(cross) > 1) bad.push(`off the line by ${cross.toFixed(1)}`);
	const way = { x: Math.sin(spot.angle), y: -Math.cos(spot.angle) };
	if (way.x * dx + way.y * dy <= 0) bad.push('points away');
	if (
		spot.x < track.left - 1 ||
		spot.x > track.right + 1 ||
		spot.y < track.top - 1 ||
		spot.y > track.bottom + 1
	)
		bad.push('off the track');
	const shrunk = (b: Rect): Rect => ({ x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 + 1, y1: b.y1 - 1 });
	const inPlay = aroundFrom(track, { x: cx, y: cy });
	for (const box of inPlay) if (strictlyInside(spot, shrunk(box))) bad.push('in a piece');
	// A little further along the line, it has left the track or met a piece: a line that only
	// grazes a piece's corner is inside it for a pixel or two, so look at a few points on the
	// line itself (the spot is rounded to whole pixels, a little off it).
	const [ux, uy] = [dx / length, dy / length];
	const t = (spot.x - cx) * ux + (spot.y - cy) * uy;
	const stops = [0.5, 1, 1.5, 2, 3].some((d) => {
		const p = { x: cx + ux * (t + d), y: cy + uy * (t + d) };
		const leaves = p.x < track.left || p.x > track.right || p.y < track.top || p.y > track.bottom;
		return leaves || inPlay.some((b) => strictlyInside(p, b));
	});
	if (!stops) bad.push('stops short');
	return bad;
}

describe('a mark on the track', () => {
	it('never stands under a piece of the HUD, on a tablet or a phone, whichever way it points', () => {
		const bad: string[] = [];
		for (const [name, layout] of Object.entries(LAYOUTS)) {
			const track = edgeTrack(layout.w, layout.h, layout.insets, layout.pieces, ARROW_CLEARANCE);
			const me = { x: layout.w / 2, y: layout.h / 2 };
			for (let deg = 0; deg < 360; deg += 0.5) {
				const there = toward(me, deg);
				const spot = spotOnTrack(me, there, track)!;
				for (const problem of checkSpot(me, there, track, spot))
					bad.push(`${name} ${deg}°: ${problem}`);
				// The arrow's picture keeps the clearance's gap (less its own half) from every piece.
				for (const piece of layout.pieces) {
					if (apart(arrowBox(spot), piece) < ARROW_CLEARANCE - 15 - 1)
						bad.push(`${name} ${deg}°: the arrow at ${spot.x},${spot.y} is on a piece`);
				}
				// And inside the safe area, by the track's inset.
				if (spot.x - 15 < layout.insets.left || spot.x + 15 > layout.w - layout.insets.right)
					bad.push(`${name} ${deg}°: in the notch`);
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('points at a friend beyond the D-pad from beside it, where it used to hide under it (#121)', () => {
		const track = edgeTrack(TABLET.w, TABLET.h, TABLET.insets, TABLET.pieces, ARROW_CLEARANCE);
		const me = { x: 512, y: 384 };
		// Down and to the left, through the D-pad: the old rectangle's corner (44, 672) was under it.
		const spot = spotOnTrack(me, { x: 44 - 468 * 3, y: 672 + 288 * 3 }, track)!;
		const dpad = TABLET.pieces[4]!;
		expect(apart(arrowBox(spot), dpad)).toBeGreaterThanOrEqual(ARROW_CLEARANCE - 15 - 1);
		// Beside it or over it, on the side towards the player: never past it.
		expect(spot.x >= dpad.x1 + ARROW_CLEARANCE - 1 || spot.y <= dpad.y0 - ARROW_CLEARANCE + 1).toBe(
			true
		);
		// Down and to the right, through Talk.
		const right = spotOnTrack(me, { x: 1024 + 2000, y: 768 + 1300 }, track)!;
		for (const piece of TABLET.pieces.slice(5))
			expect(apart(arrowBox(right), piece)).toBeGreaterThan(0);
	});

	it('keeps a screen with no pieces to the old rectangle, and is nowhere for the player’s own spot', () => {
		const track = edgeTrack(1024, 768, NONE, [], ARROW_CLEARANCE);
		const me = { x: 512, y: 384 };
		for (const there of [
			{ x: 5000, y: 384 },
			{ x: -300, y: 100 },
			{ x: 512, y: -9000 },
			{ x: 900, y: 2000 }
		]) {
			const spot = spotOnTrack(me, there, track)!;
			expect(spot.x <= 44 || spot.x >= 1024 - 44 || spot.y <= 44 || spot.y >= 768 - 96).toBe(true);
			expect(checkSpot(me, there, track, spot)).toEqual([]);
		}
		expect(spotOnTrack(me, me, track)).toBeNull();
	});

	it('stops before a piece the player stands near, and goes past it the other way', () => {
		// The message line reaching up to 16 px under the player, as many lines can on a phone:
		// nearer than an arrow's clearance, so it keeps what room there is.
		const line = { x0: 400, x1: 620, y0: 400, y1: 500 };
		const track = edgeTrack(1024, 768, NONE, [line], ARROW_CLEARANCE);
		const me = { x: 512, y: 384 };
		const down = spotOnTrack(me, { x: 512, y: 9000 }, track)!;
		expect(down.y).toBeGreaterThan(me.y);
		expect(down.y).toBeLessThanOrEqual(line.y0);
		expect(spotOnTrack(me, { x: 512, y: -9000 }, track)).toEqual({ x: 512, y: 44, angle: 0 });
	});

	it('never stands nearer the player than it is asked to, where the edge is further', () => {
		const crowded = edgeTrack(
			1024,
			768,
			NONE,
			[{ x0: 400, x1: 620, y0: 400, y1: 500 }],
			ARROW_CLEARANCE
		);
		const me = { x: 512, y: 384 };
		expect(spotOnTrack(me, { x: 512, y: 9000 }, crowded, 40)).toEqual({
			x: 512,
			y: 424,
			angle: Math.round(Math.PI * 100) / 100
		});
		// By the edge, the edge wins: the player 20 px from the track's top, and 40 asked.
		const open = edgeTrack(1024, 768, NONE, [], ARROW_CLEARANCE);
		expect(spotOnTrack({ x: 512, y: 64 }, { x: 512, y: -9000 }, open, 40)).toEqual({
			x: 512,
			y: 44,
			angle: 0
		});
	});

	it('goes past a piece the player stands in, as on a screen too small for it', () => {
		const around = [{ x0: 400, x1: 600, y0: 300, y1: 500 }];
		const track = edgeTrack(1024, 768, NONE, around, ARROW_CLEARANCE);
		const spot = spotOnTrack({ x: 512, y: 384 }, { x: 512, y: -9000 }, track)!;
		expect(spot).toEqual({ x: 512, y: 44, angle: 0 });
	});

	it('holds on any screen, any safe area and any pieces, from anywhere on it', () => {
		const rng = new Rng(20260928);
		const bad: string[] = [];
		for (let n = 0; n < 400; n++) {
			const w = rng.int(480, 1600);
			const h = rng.int(320, 1100);
			const insets = {
				top: rng.int(0, 30),
				right: rng.int(0, 60),
				bottom: rng.int(0, 30),
				left: rng.int(0, 60)
			};
			const pieces: Rect[] = Array.from({ length: rng.int(0, 9) }, () => {
				const x0 = rng.int(-20, w);
				const y0 = rng.int(-20, h);
				return { x0, x1: x0 + rng.int(10, 300), y0, y1: y0 + rng.int(10, 300) };
			});
			const track = edgeTrack(w, h, insets, pieces, ARROW_CLEARANCE);
			const me = { x: rng.int(0, w), y: rng.int(0, h) };
			const there = { x: rng.int(-3 * w, 4 * w), y: rng.int(-3 * h, 4 * h) };
			const spot = spotOnTrack(me, there, track);
			if (!spot) {
				if (there.x !== me.x || there.y !== me.y) bad.push(`#${n}: no spot`);
				continue;
			}
			for (const problem of checkSpot(me, there, track, spot)) bad.push(`#${n}: ${problem}`);
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});

describe('ways', () => {
	const heading = (pid: string, x: number, y: number, angle = 0): Heading => ({
		pid,
		name: pid.toUpperCase(),
		spot: { x, y, angle }
	});

	it('gives friends far off the same way one arrow with both names, nearest first (#140)', () => {
		// Ada and Bo, two tiles apart and 190 steps off: the same rough bearing, the very same spot.
		const ways = gatherWays([
			heading('ada', 44, 299),
			heading('bo', 44, 299),
			heading('cy', 600, 44)
		]);
		expect(ways).toEqual([
			{ key: 'ada', x: 44, y: 299, angle: 0, names: ['ADA', 'BO'], more: 0 },
			{ key: 'cy', x: 600, y: 44, angle: 0, names: ['CY'], more: 0 }
		]);
	});

	it('names four, and past four three and how many more; on a phone two, or one and how many more', () => {
		const five = ['a', 'b', 'c', 'd', 'e'].map((pid, i) => heading(pid, 44 + i, 300));
		expect(gatherWays(five.slice(0, MAX_NAMES))[0]).toMatchObject({
			names: ['A', 'B', 'C', 'D'],
			more: 0
		});
		expect(gatherWays(five)[0]).toMatchObject({ names: ['A', 'B', 'C'], more: 2 });
		expect(gatherWays(five.slice(0, 2), SHORT_NAMES)[0]).toMatchObject({
			names: ['A', 'B'],
			more: 0
		});
		expect(gatherWays(five.slice(0, 3), SHORT_NAMES)[0]).toMatchObject({ names: ['A'], more: 2 });
	});

	it('keeps arrows apart that stand apart, at most four ways, and lets anyone further join a way shown', () => {
		const apartBy = GATHER_PX;
		const ways = gatherWays([
			heading('a', 100, 44),
			heading('b', 100 + apartBy, 44),
			heading('c', 500, 44),
			heading('d', 44, 400),
			heading('e', 980, 400), // a fifth way: not shown
			heading('f', 101, 45) // far, but where the first way's arrow stands: named there
		]);
		expect(ways.map((w) => w.key)).toEqual(['a', 'b', 'c', 'd']);
		expect(ways.length).toBe(MAX_WAYS);
		expect(ways[0]!.names).toEqual(['A', 'F']);
		expect(ways[1]!.names).toEqual(['B']);
	});
});

describe("a way's names", () => {
	/** The block's box where `placeNames` puts it. */
	function blockBox(
		spot: Spot,
		size: { w: number; h: number },
		at: { dx: number; dy: number }
	): Rect {
		return {
			x0: spot.x + at.dx,
			x1: spot.x + at.dx + size.w,
			y0: spot.y + at.dy,
			y1: spot.y + at.dy + size.h
		};
	}

	it('stand beside the arrow towards the middle of the screen, the gap away, when nothing is in the way', () => {
		const bounds = { x0: 8, x1: 1016, y0: 8, y1: 760 };
		const cases: [number, 'right' | 'left' | 'under' | 'over'][] = [
			[-Math.PI / 2, 'right'],
			[Math.PI / 2, 'left'],
			[0, 'under'],
			[Math.PI, 'over']
		];
		for (const [angle, side] of cases) {
			expect(namesSide(angle)).toBe(side);
			const [at] = placeNames([{ x: 512, y: 384, angle, w: 60, h: 26 }], [], bounds);
			const expected = {
				right: { dx: NAME_GAP, dy: -13 },
				left: { dx: -NAME_GAP - 60, dy: -13 },
				under: { dx: -30, dy: NAME_GAP },
				over: { dx: -30, dy: -NAME_GAP - 26 }
			}[side];
			expect(at).toEqual(expected);
		}
	});

	it('keep clear of every piece and stay on the screen, whichever way the arrow points, as many as a way names', () => {
		const bad: string[] = [];
		for (const [name, layout] of Object.entries(LAYOUTS)) {
			const track = edgeTrack(layout.w, layout.h, layout.insets, layout.pieces, ARROW_CLEARANCE);
			const me = { x: layout.w / 2, y: layout.h / 2 };
			const bounds = {
				x0: layout.insets.left + 8,
				x1: layout.w - layout.insets.right - 8,
				y0: layout.insets.top + 8,
				y1: layout.h - layout.insets.bottom - 8
			};
			for (let deg = 0; deg < 360; deg += 2) {
				const spot = spotOnTrack(me, toward(me, deg), track)!;
				for (let rows = 1; rows <= rowsOn(layout); rows++) {
					// A row is a name's pill, 26 px tall, 3 px apart; a long name is 170 px wide.
					const size = { w: 170, h: rows * 29 - 3 };
					const [at] = placeNames([{ ...spot, ...size }], layout.pieces, bounds);
					const box = blockBox(spot, size, at!);
					for (const piece of layout.pieces)
						if (apart(box, piece) < NAME_CLEAR - 0.5)
							bad.push(`${name} ${deg}° ${rows} names: on a piece`);
					if (
						box.x0 < bounds.x0 - 0.5 ||
						box.x1 > bounds.x1 + 0.5 ||
						box.y0 < bounds.y0 - 0.5 ||
						box.y1 > bounds.y1 + 0.5
					)
						bad.push(`${name} ${deg}° ${rows} names: off the screen`);
					// Near the arrow still: where a phone's top corners leave no room, the names go
					// under them, in line with the arrow.
					if (apart(box, arrowBox(spot)) > 100)
						bad.push(`${name} ${deg}° ${rows} names: far from the arrow`);
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});

	it('keep clear of the other arrows and names, however near two ways stand', () => {
		const bad: string[] = [];
		const rng = new Rng(140);
		for (const [name, layout] of Object.entries(LAYOUTS)) {
			const track = edgeTrack(layout.w, layout.h, layout.insets, layout.pieces, ARROW_CLEARANCE);
			const me = { x: layout.w / 2, y: layout.h / 2 };
			const bounds = {
				x0: layout.insets.left + 8,
				x1: layout.w - layout.insets.right - 8,
				y0: layout.insets.top + 8,
				y1: layout.h - layout.insets.bottom - 8
			};
			for (let n = 0; n < 300; n++) {
				// Two ways a few degrees apart, as many names as a way shows there, of any length.
				const deg = rng.int(0, 359);
				const spots = [deg, deg + rng.int(8, 40)].map((d) =>
					spotOnTrack(me, toward(me, d), track)!
				);
				const ways = gatherWays(spots.map((spot, i) => ({ pid: `p${i}`, name: 'Ada', spot })));
				const blocks = ways.map((way) => ({
					...way,
					w: rng.int(40, 170),
					h: rng.int(1, rowsOn(layout)) * 29 - 3
				}));
				const at = placeNames(blocks, layout.pieces, bounds);
				const boxes = blocks.map((b, i) => blockBox(b, b, at[i]!));
				for (let i = 0; i < boxes.length; i++) {
					for (let j = 0; j < boxes.length; j++) {
						if (i === j) continue;
						if (apart(boxes[i]!, arrowBox(blocks[j]!)) < NAME_CLEAR - 0.5)
							bad.push(`${name} #${n}: names on another arrow`);
						if (j > i && apart(boxes[i]!, boxes[j]!) < NAME_CLEAR - 0.5)
							bad.push(`${name} #${n}: names on names`);
					}
				}
			}
		}
		expect(bad.slice(0, 20)).toEqual([]);
	});
});

describe('a short screen', () => {
	it('is SHORT_SCREEN in every short-screen query of the explore HUD, the line its names cap by', () => {
		const files = ['src/ui/Hud.svelte', 'src/ui/PresenceNote.svelte'];
		const heights = files.flatMap((file) =>
			[...(svelteSources.get(file) ?? '').matchAll(/@media \(max-height: (\d+)px\)/g)].map((m) => ({
				file,
				height: Number(m[1])
			}))
		);
		expect(heights.length).toBeGreaterThanOrEqual(files.length);
		expect(heights.filter(({ height }) => height !== SHORT_SCREEN)).toEqual([]);
	});

	it('is SHORT_SCREEN where the druid’s puzzle takes the whole card, over the explore screen', () => {
		const source = svelteSources.get('src/ui/DoctorCard.svelte') ?? '';
		// The query whose rules lay out `.solo`: the card's only height query, as it stands.
		const phone = (parse(source, { modern: true }).css?.children ?? []).filter(
			(node): node is AST.CSS.Atrule =>
				node.type === 'Atrule' &&
				node.name === 'media' &&
				node.prelude.startsWith('(max-height') &&
				(node.block?.children ?? []).some(
					(rule) =>
						rule.type === 'Rule' &&
						source.slice(rule.prelude.start, rule.prelude.end).includes('.solo')
				)
		);
		expect(phone.map((media) => media.prelude)).toEqual([`(max-height: ${SHORT_SCREEN}px)`]);
	});
});
