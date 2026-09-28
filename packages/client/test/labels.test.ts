import { Rng } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { MARK_GAP, unclutter, type Mark, type Offset, type Rect } from '../src/presence/labels';

/**
 * The words over the world laid out so none covers another (#141): a
 * player's label rises over a tall animal's tag, two tags side by side make
 * room for each other, and over any scene of battles and players nothing is
 * left touching, a label never moves sideways, and the same scene always
 * settles the same way.
 */

/** A tag over an animal, anchored at the middle of its bottom edge, `w` × `h`. */
function tag(key: string, x: number, y: number, w = 72, h = 30): Mark {
	return { key, x, y, parts: [{ x0: -w / 2, x1: w / 2, y0: -h, y1: 0 }] };
}

/** A player's label: the name pill, and over it a thought cloud of `thought` width leaning `lean`. */
function label(key: string, x: number, y: number, name = 50, thought = 0, lean = 0): Mark {
	const parts: Rect[] = [{ x0: -name / 2, x1: name / 2, y0: -28, y1: -2 }];
	if (thought > 0) {
		const shift = lean * 0.32 * thought;
		parts.push({ x0: -thought / 2 + shift, x1: thought / 2 + shift, y0: -75, y1: -31 });
	}
	return { key, x, y, parts };
}

/** Every mark's boxes where the layout puts them. */
function placed(marks: Mark[], offsets: Map<string, Offset>): { key: string; box: Rect }[] {
	return marks.flatMap((m) => {
		const o = offsets.get(m.key) ?? { dx: 0, dy: 0 };
		return m.parts.map((p) => ({
			key: m.key,
			box: {
				x0: m.x + o.dx + p.x0,
				x1: m.x + o.dx + p.x1,
				y0: m.y + o.dy + p.y0,
				y1: m.y + o.dy + p.y1
			}
		}));
	});
}

/**
 * Pairs of different marks whose boxes cover each other, or stand one over
 * the other in the same columns closer than the gap.
 */
function clashes(marks: Mark[], offsets: Map<string, Offset>): string[] {
	const boxes = placed(marks, offsets);
	const found: string[] = [];
	const near = (a: Rect, b: Rect) =>
		a.x0 < b.x1 - 1e-9 &&
		b.x0 < a.x1 - 1e-9 &&
		a.y0 < b.y1 + MARK_GAP - 1e-9 &&
		b.y0 < a.y1 + MARK_GAP - 1e-9;
	for (let i = 0; i < boxes.length; i++) {
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (a.key !== b.key && near(a.box, b.box)) found.push(`${a.key} × ${b.key}`);
		}
	}
	return found;
}

describe('the labels over the world', () => {
	it("lifts a player's name over their tall animal's tag, and leaves the tag where it is", () => {
		// As #141 shows it: the lynx's tag, up at Ada's name, its right end under it.
		const ada = label('ada', 400, 300, 56);
		const lynx = tag('lynx', 350, 302);
		const offsets = unclutter([ada], [lynx]);
		expect(offsets.get('lynx')).toBeUndefined();
		const up = offsets.get('ada')!;
		expect(up.dx).toBe(0);
		// Its name's bottom just over the tag's top, the gap between.
		expect(300 + up.dy - 2).toBe(302 - 30 - MARK_GAP);
		expect(clashes([ada, lynx], offsets)).toEqual([]);
	});

	it('moves two tags side by side apart, half each, the left one to the left', () => {
		// The moose's and the wolverine's, touching.
		const wolverine = tag('wolverine', 300, 400, 70);
		const moose = tag('moose', 360, 395, 60);
		const offsets = unclutter([], [moose, wolverine]);
		const w = offsets.get('wolverine')!;
		const m = offsets.get('moose')!;
		expect(w.dx).toBeLessThan(0);
		expect(m.dx).toBeGreaterThan(0);
		expect(m.dx).toBeCloseTo(-w.dx);
		expect(w.dy).toBe(0);
		expect(m.dy).toBe(0);
		expect(clashes([moose, wolverine], offsets)).toEqual([]);
	});

	it('lifts the upper of two tags one behind the other over the lower one', () => {
		const near = tag('near', 400, 420);
		const far = tag('far', 404, 400);
		const offsets = unclutter([], [near, far]);
		expect(offsets.get('near')).toBeUndefined();
		expect(offsets.get('far')!.dx).toBe(0);
		expect(offsets.get('far')!.dy).toBe(420 - 30 - MARK_GAP - 400);
	});

	it('leaves a name that only stands close beside a tag where it is', () => {
		// Dee's cloud grows from dots to a sum, leaning off the battle: its edge ends under 3 px
		// from the moose's tag, which is up at its height. It covers nothing, so nothing moves.
		const moose = tag('moose', 654, 60, 60);
		const dee = label('dee', 710, 110, 48, 130, 1);
		const cloudLeft = 710 - 65 + 0.32 * 130;
		expect(cloudLeft - (654 + 30)).toBeCloseTo(2.6);
		expect(unclutter([dee], [moose]).size).toBe(0);
	});

	it('moves nothing that covers nothing', () => {
		const offsets = unclutter(
			[label('ada', 100, 100), label('bo', 400, 100, 40, 120, 1)],
			[tag('a', 100, 200), tag('b', 400, 200)]
		);
		expect(offsets.size).toBe(0);
	});

	it('lifts the thought cloud with its name, and leans it off the tags', () => {
		// Ada thinks; her cloud leans right, away from the battle on her left.
		const ada = label('ada', 400, 300, 56, 150, 1);
		const lynx = tag('lynx', 340, 300);
		const offsets = unclutter([ada], [lynx]);
		expect(clashes([ada, lynx], offsets)).toEqual([]);
		// Leaning the other way, over the tag, it has further to rise.
		const over = label('ada', 400, 300, 56, 150, -1);
		const higher = unclutter([over], [lynx]).get('ada')!;
		expect(higher.dy).toBeLessThanOrEqual(offsets.get('ada')?.dy ?? 0);
	});

	it('leaves nothing touching over any scene of battles and players, never moves a label sideways, and settles the same way whatever the order', () => {
		const rng = new Rng(141);
		for (let scene = 0; scene < 400; scene++) {
			const labels: Mark[] = [];
			const tags: Mark[] = [];
			const fights = rng.int(1, 6);
			for (let f = 0; f < fights; f++) {
				// Two players side by side, their two animals in front, of any size (a tag's height
				// on the screen is its animal's), as a match stands them, packed into a small screen.
				const x = rng.int(100, 900);
				const y = rng.int(150, 650);
				for (const side of [-1, 1]) {
					labels.push(
						label(
							`p${f}${side}`,
							x + side * rng.int(20, 70),
							y + rng.int(-10, 10),
							rng.int(30, 160),
							rng.chance(0.5) ? rng.int(46, 170) : 0,
							side
						)
					);
					tags.push(
						tag(
							`t${f}${side}`,
							x + side * rng.int(10, 60),
							y + rng.int(-40, 60),
							rng.int(60, 120),
							rng.int(28, 36)
						)
					);
				}
			}
			// Someone walking by.
			if (rng.chance(0.5)) labels.push(label('walker', rng.int(100, 900), rng.int(150, 650)));
			const offsets = unclutter(labels, tags);
			const all = [...labels, ...tags];
			expect(clashes(all, offsets), `scene ${scene}`).toEqual([]);
			for (const l of labels) {
				const o = offsets.get(l.key);
				if (o) {
					expect(o.dx).toBe(0);
					expect(o.dy).toBeLessThan(0);
				}
			}
			const shuffled = unclutter([...labels].reverse(), [...tags].reverse());
			expect([...shuffled.entries()].sort()).toEqual([...offsets.entries()].sort());
		}
	});
});
