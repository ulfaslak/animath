import { Rng } from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { padDirection } from '../src/input/dpad';
import {
	EDGE_PX,
	EDGE_SPEED,
	HOLD_MS,
	HOLD_SLOP_PX,
	LIFT_PX,
	carriedBy,
	dragPhase,
	edgeSpeed,
	landing,
	shiftOf,
	slotTop,
	type Column,
	type DragPhase,
	type Pointer
} from '../src/input/drag';
import {
	animalKey,
	languageKey,
	levelKey,
	optionKey,
	rowKey,
	tabKey,
	tappedLanguage,
	tappedLevel,
	tappedOption,
	tappedRow,
	tappedTab
} from '../src/input/press';
import { DOUBLE_TAP_MS, TAP_SLOP_PX, Taps, type Point, type Pressable } from '../src/input/taps';
import { touchAfter } from '../src/input/touch.svelte';

/**
 * The small rules of pointer input: the pointer's own key names, which arrow
 * of the D-pad a finger presses, when the touch controls show, what a tap
 * is, and what a drag of a party card is.
 */
describe("the pointer's keys", () => {
	it('name a row, an option, a level, a language or a tab, and nothing a keyboard sends', () => {
		expect(tappedRow(rowKey(0))).toBe(0);
		expect(tappedRow(rowKey(12))).toBe(12);
		expect(tappedOption(optionKey(4))).toBe(4);
		expect(tappedLevel(levelKey(3))).toBe(3);
		expect(tappedLanguage(languageKey('da'))).toBe('da');
		expect(tappedTab(tabKey('home'))).toBe('home');
		// The pause menu's team and its options are on screen together: neither's key is the other's (#45).
		// So are the doctor's tabs, its rows and its confirm's choices.
		expect(tappedOption(rowKey(0))).toBeUndefined();
		expect(tappedRow(optionKey(0))).toBeUndefined();
		for (const key of [rowKey(0), optionKey(1), 'tab:bank', 'tab:']) {
			expect(tappedTab(key), key).toBeUndefined();
		}
		expect(tappedRow(tabKey('heal'))).toBeUndefined();
		// What a keyboard sends is never one of them: one character, or a key's name.
		for (const key of ['Enter', ' ', '1', 'r', 'ArrowUp', 'Escape', 'Backspace', '-', 'Process']) {
			expect([
				tappedRow(key),
				tappedOption(key),
				tappedLevel(key),
				tappedLanguage(key),
				tappedTab(key)
			]).toEqual([undefined, undefined, undefined, undefined, undefined]);
		}
		expect(tappedLevel('level:4')).toBeUndefined();
		expect(tappedRow('row:-1')).toBeUndefined();
	});
});

describe('the D-pad', () => {
	it('presses the arrow the finger is furthest along, and none at the centre', () => {
		expect(padDirection(0, 0, 20)).toBeNull();
		expect(padDirection(12, -12, 20)).toBeNull();
		expect(padDirection(0, -60, 20)).toBe('up');
		expect(padDirection(0, 60, 20)).toBe('down');
		expect(padDirection(-60, 10, 20)).toBe('left');
		expect(padDirection(60, -10, 20)).toBe('right');
		// Screen y grows downward, as the grid's does: below the centre is down.
		expect(padDirection(5, 30, 20)).toBe('down');
		// A finger slid far off the pad keeps its arrow.
		expect(padDirection(900, 40, 20)).toBe('right');
	});
});

describe('the touch controls', () => {
	const key = (k: string, trusted = true, typing = false) =>
		({ kind: 'key', key: k, trusted, typing }) as const;
	const pointer = (pointerType: string) => ({ kind: 'pointer', pointerType }) as const;

	it('show after a touch or a pen, and a mouse changes nothing', () => {
		expect(touchAfter(false, pointer('touch'))).toBe(true);
		expect(touchAfter(false, pointer('pen'))).toBe(true);
		expect(touchAfter(false, pointer('mouse'))).toBe(false);
		expect(touchAfter(true, pointer('mouse'))).toBe(true);
	});

	it('go after a key on a real keyboard, but not for the pointer’s own keys, typing or a modifier', () => {
		expect(touchAfter(true, key('ArrowUp'))).toBe(false);
		expect(touchAfter(true, key('Enter'))).toBe(false);
		// Go, the number pad, the D-pad: key presses the page made itself.
		expect(touchAfter(true, key('Enter', false))).toBe(true);
		expect(touchAfter(true, key('row:2', false))).toBe(true);
		// The tablet's own keyboard, typing a name into the name box.
		expect(touchAfter(true, key('p', true, true))).toBe(true);
		expect(touchAfter(true, key('Shift'))).toBe(true);
		expect(touchAfter(true, key('Unidentified'))).toBe(true);
		expect(touchAfter(false, key('ArrowUp'))).toBe(false);
	});
});

/**
 * A tap is a press that begins and ends on one button, on one screen, each
 * pointer on its own (`input/taps.ts`). The buttons are stand-ins that know
 * what they contain, as elements do, and the key they press, as `data-press`
 * says it.
 */
describe('taps', () => {
	/** A button that presses `key`, and a part of it (a level button in a row, the text in a pill). */
	class Box implements Pressable {
		constructor(
			public key: string | undefined,
			private parts: Pressable[] = []
		) {}
		contains(other: Pressable | null): boolean {
			return other === this || this.parts.some((p) => p === other || p.contains(other));
		}
	}
	const inner = new Box(undefined);
	const run = new Box(rowKey(4), [inner]);
	const go = new Box('Enter');
	const menu = new Box('Escape');
	const dpad = new Box(undefined); // walks by itself: it has no key to tap
	const here = { x: 700, y: 630 };
	const far = { x: 700, y: 630 + TAP_SLOP_PX + 1 };
	/** Where the pointer lifts: on its button, or off it. */
	const on = () => true;
	const off = () => false;
	const newTaps = () => new Taps<Box>((button) => button.key);

	it('a finger that goes down on a button and lifts on it presses its key, once', () => {
		const taps = newTaps();
		taps.down(1, go, 7, here);
		expect(taps.up(1, go, 7, here, on)).toBe('Enter');
		expect(taps.up(1, go, 7, here, on)).toBeUndefined();
		taps.down(2, run, 7, here);
		expect(taps.up(2, inner, 7, here, on)).toBe(rowKey(4)); // lifted over a part of it
		// Moved along a wide row and still on it.
		taps.down(3, run, 7, here);
		expect(taps.up(3, run, 7, far, on)).toBe(rowKey(4));
	});

	it('a finger lifted over a button it did not go down on presses nothing there (#39)', () => {
		// A thumb held on the D-pad as a battle takes the screen, lifted over Run.
		const taps = newTaps();
		taps.down(1, null, 3, here); // on no button: the D-pad's arms are not buttons
		expect(taps.up(1, run, 4, here, on)).toBeUndefined();
		// Down on a button that left the page (the button lets go of it), up on another.
		taps.down(2, go, 4, here);
		expect(taps.up(2, run, 4, here, on)).toBeUndefined();
		expect(taps.up(3, go, 4, here, on)).toBeUndefined(); // up with no down at all
	});

	it('a finger that slides off its button before lifting presses nothing', () => {
		const taps = newTaps();
		taps.down(1, go, 4, here);
		expect(taps.up(1, go, 4, far, off)).toBeUndefined();
	});

	it('a button that changes shape under a still finger takes the tap (the first touch after keys)', () => {
		// Go!'s key cap goes as the touch controls come on: the finger is no longer over it.
		const taps = newTaps();
		taps.down(1, go, 4, here);
		expect(taps.up(1, go, 4, here, off)).toBe('Enter');
	});

	it('a row that moved under a resting finger presses nothing, not the row now in its place (#45)', () => {
		// A finger rests on the rabbit, row 1 of the team, while another finger moves the
		// fox up past it: the rabbit's row is row 2 now, and row 1 is the fox's.
		const taps = newTaps();
		const rabbit = new Box(rowKey(1));
		taps.down(1, rabbit, 6, here);
		rabbit.key = rowKey(2);
		expect(taps.up(1, rabbit, 6, here, on)).toBeUndefined();
		// A button whose key stays put taps as ever, whatever else moved.
		taps.down(2, rabbit, 6, here);
		expect(taps.up(2, rabbit, 6, here, on)).toBe(rowKey(2));
	});

	it('a press counts only on the screen it began on', () => {
		// Down on Go! while the turn plays, lifted once the menu is back.
		const taps = newTaps();
		taps.down(1, go, 11, here);
		expect(taps.up(1, go, 12, here, on)).toBeUndefined();
	});

	it('follows each finger on its own: a thumb on the D-pad never stops a tap on Menu (#40)', () => {
		const taps = newTaps();
		taps.down(1, dpad, 5, here); // walking, and staying down
		taps.down(2, menu, 5, far);
		expect(taps.up(2, menu, 5, far, on)).toBe('Escape');
		expect(taps.up(1, dpad, 5, here, on)).toBeUndefined();
		// Two taps at once, lifted in either order.
		taps.down(3, go, 5, here);
		taps.down(4, menu, 5, far);
		expect(taps.up(4, menu, 5, far, on)).toBe('Escape');
		expect(taps.up(3, go, 5, here, on)).toBe('Enter');
	});

	it('a pointer the browser takes for a scroll taps nothing, and a new press forgets an old one', () => {
		const taps = newTaps();
		taps.down(1, run, 2, here);
		taps.cancel(1);
		expect(taps.up(1, run, 2, here, on)).toBeUndefined();
		// The mouse (always pointer 1): down on Go!, then down on nothing and up over Go!.
		taps.down(1, go, 2, here);
		taps.down(1, null, 2, here);
		expect(taps.up(1, go, 2, here, on)).toBeUndefined();
	});

	it('has no time limit: a finger that rests on its button a long while still taps it', () => {
		const taps = newTaps();
		taps.down(1, go, 4, here, 0);
		expect(taps.up(1, go, 4, here, on, 60_000)).toBe('Enter');
	});

	describe('a double click or tap', () => {
		/** A row of a list, `top` px down the screen and 40 px tall, that a re-sort can move (-1: gone). */
		class Row extends Box {
			constructor(
				key: string,
				public top: number
			) {
				super(key);
			}
		}
		const standsAt = (row: Row, at: Point) =>
			row.top >= 0 && at.y >= row.top && at.y < row.top + 40;
		const middle = (row: Row): Point => ({ x: 400, y: row.top + 20 });
		const newRows = () => new Taps<Row>((row) => row.key, standsAt);
		/** Down on `row` at `at` at `time` ms, up 80 ms later: the key it pressed. */
		const click = (taps: Taps<Row>, row: Row | null, at: Point, time: number) => {
			taps.down(1, row, 3, at, time);
			return taps.up(1, row, 3, at, on, time + 80);
		};

		it('whose first half moved its row away presses nothing on the row that slid into its place (#72)', () => {
			// Rusty, Pip and Rex on an open card, Pip double-clicked: the first click puts Pip in
			// front, and Rusty slides into Pip's row before the second click lands there.
			const taps = newRows();
			const rusty = new Row(animalKey('rusty'), 100);
			const pip = new Row(animalKey('pip'), 140);
			const at = middle(pip);
			expect(click(taps, pip, at, 1000)).toBe(animalKey('pip'));
			[pip.top, rusty.top] = [100, 140];
			for (const gap of [60, 250, DOUBLE_TAP_MS]) {
				expect(click(taps, rusty, at, 1080 + gap), `${gap} ms later`).toBeUndefined();
			}
			// The first half's row left the page (the card closed): what is there now takes no tap either.
			const fox = new Row(rowKey(0), 140);
			const alone = newRows();
			expect(click(alone, fox, at, 0)).toBe(rowKey(0));
			fox.top = -1;
			expect(click(alone, new Row(rowKey(3), 130), at, 300)).toBeUndefined();
		});

		it('is two clicks when nothing moved, or on the same key, and a quick tap on the next row counts', () => {
			const taps = newRows();
			const down = new Row(optionKey(2), 200); // Move down: the options stay put as the team re-sorts
			expect(click(taps, down, middle(down), 0)).toBe(optionKey(2));
			expect(click(taps, down, middle(down), 200)).toBe(optionKey(2));
			// Two rows of the doctor's list tapped quickly, close to the edge between them.
			const one = new Row(rowKey(1), 300);
			const two = new Row(rowKey(2), 340);
			expect(click(taps, one, { x: 400, y: 337 }, 1000)).toBe(rowKey(1));
			expect(click(taps, two, { x: 400, y: 343 }, 1200)).toBe(rowKey(2));
			// A row drawn again in the same place for the same thing is the same key: it taps.
			const again = new Row(rowKey(2), 340);
			two.top = -1;
			expect(click(taps, again, { x: 400, y: 343 }, 1400)).toBe(rowKey(2));
		});

		it('slower than DOUBLE_TAP_MS, or further away than a wobble, is a new click on what is there', () => {
			const slow = newRows();
			const rusty = new Row(animalKey('rusty'), 100);
			const pip = new Row(animalKey('pip'), 140);
			const at = middle(pip);
			expect(click(slow, pip, at, 0)).toBe(animalKey('pip'));
			[pip.top, rusty.top] = [100, 140];
			expect(click(slow, rusty, at, 80 + DOUBLE_TAP_MS + 1)).toBe(animalKey('rusty'));
			const far = newRows();
			const rex = new Row(animalKey('rex'), 180);
			[pip.top, rusty.top] = [140, 100];
			expect(click(far, pip, at, 0)).toBe(animalKey('pip'));
			[pip.top, rusty.top] = [100, 140];
			expect(click(far, rex, { x: 400, y: at.y + TAP_SLOP_PX + 21 }, 200)).toBe(animalKey('rex'));
		});
	});
});

describe('dragging a party card', () => {
	/** A column of 2 to 12 cards of the heights cards have (one animal, a stack, two lines), 8 px apart. */
	function randomColumn(rng: Rng): Column {
		const heights = Array.from({ length: rng.int(2, 12) }, () =>
			rng.pick([48, 56, 60, 65, 66, 73, 86])
		);
		const tops: number[] = [];
		let y = 4;
		for (const h of heights) {
			tops.push(y);
			y += h + 8;
		}
		return { tops, heights };
	}
	const columns = (count: number) => {
		const rng = new Rng(70);
		return Array.from({ length: count }, () => randomColumn(rng));
	};

	it('carried as far as it goes, a card lands first or last, whatever the cards it passed (#70)', () => {
		const bad: string[] = [];
		for (const column of columns(2000)) {
			const last = column.tops.length - 1;
			for (let from = 0; from <= last; from++) {
				const top = landing(column, from, carriedBy(column, from, -10_000));
				const bottom = landing(column, from, carriedBy(column, from, 10_000));
				if (top !== 0 || bottom !== last) {
					bad.push(`${column.heights.join('/')} from ${from}: top ${top}, bottom ${bottom}`);
				}
			}
		}
		expect(bad.slice(0, 20), `${bad.length} in all`).toEqual([]);
	});

	it('lands where it is drawn: its own place unmoved, a slot it is drawn in, and never back up as it goes down', () => {
		const bad: string[] = [];
		for (const column of columns(200)) {
			const { tops } = column;
			const last = tops.length - 1;
			for (let from = 0; from <= last; from++) {
				if (landing(column, from, 0) !== from)
					bad.push(`${column.heights.join('/')}: ${from} moved`);
				for (let to = 0; to <= last; to++) {
					const at = landing(column, from, slotTop(column, from, to) - tops[from]!);
					if (at !== to)
						bad.push(`${column.heights.join('/')}: ${from} drawn at ${to} lands ${at}`);
				}
				let was = 0;
				for (
					let by = carriedBy(column, from, -10_000);
					by <= carriedBy(column, from, 10_000);
					by += 2
				) {
					const to = landing(column, from, by);
					if (to < was) bad.push(`${column.heights.join('/')}: ${from} at ${by} back to ${to}`);
					was = to;
				}
			}
		}
		expect(bad.slice(0, 20), `${bad.length} in all`).toEqual([]);
	});

	it('draws the others aside so the gap is where it lands, and the dropped card in its new place', () => {
		const bad: string[] = [];
		for (const column of columns(400)) {
			const { tops, heights } = column;
			const last = tops.length - 1;
			for (let from = 0; from <= last; from++) {
				for (let to = 0; to <= last; to++) {
					// The column as the party will stand: the card at `from` moved to `to`.
					const order = tops.map((_, k) => k).filter((k) => k !== from);
					order.splice(to, 0, from);
					let y = tops[0]!;
					for (const k of order) {
						const drawn = tops[k]! + shiftOf(column, from, to, k, 0, true);
						if (drawn !== y)
							bad.push(`${heights.join('/')}: ${from}→${to}, card ${k} at ${drawn}, not ${y}`);
						y += heights[k]! + 8;
					}
				}
			}
		}
		expect(bad.slice(0, 20), `${bad.length} in all`).toEqual([]);
	});

	it('time alone never makes a drag: a press that stays still taps, however long it rests', () => {
		const bad: string[] = [];
		for (const pointer of ['mouse', 'finger'] as Pointer[]) {
			let phase: DragPhase | 'scroll' = 'pressed';
			for (let ms = 0; ms <= 10_000 && phase !== 'scroll'; ms += 50) {
				// A finger's tremble, never past a mouse's lift or a finger's hold.
				phase = dragPhase(pointer, phase, ms % 100 ? 3 : 0, ms);
				if (phase === 'carried' || phase === 'scroll') bad.push(`${pointer} at ${ms} ms: ${phase}`);
			}
			if (phase !== (pointer === 'finger' ? 'lifted' : 'pressed'))
				bad.push(`${pointer} ends ${phase}`);
		}
		expect(bad).toEqual([]);
	});

	it('a mouse carries a card once it moves; a finger holds still to lift it, then moves to carry it', () => {
		expect(dragPhase('mouse', 'pressed', LIFT_PX, 0)).toBe('pressed');
		expect(dragPhase('mouse', 'pressed', LIFT_PX + 1, 0)).toBe('carried');
		// A finger that moves first is scrolling the column.
		expect(dragPhase('finger', 'pressed', HOLD_SLOP_PX + 1, HOLD_MS - 1)).toBe('scroll');
		expect(dragPhase('finger', 'pressed', HOLD_SLOP_PX, HOLD_MS - 1)).toBe('pressed');
		expect(dragPhase('finger', 'pressed', HOLD_SLOP_PX, HOLD_MS)).toBe('lifted');
		// Lifted, it still taps until it has moved past the tap's own slop.
		expect(dragPhase('finger', 'lifted', TAP_SLOP_PX, 5_000)).toBe('lifted');
		expect(dragPhase('finger', 'lifted', TAP_SLOP_PX + 1, 5_000)).toBe('carried');
		// Carried back to where it was, it is still a drag, never a tap.
		expect(dragPhase('finger', 'carried', 0, 5_000)).toBe('carried');
		expect(dragPhase('mouse', 'carried', 0, 5_000)).toBe('carried');
	});

	it('scrolls the column at the edge the card is carried to, faster the deeper, however still it rests', () => {
		const view = { top: 20, bottom: 460 };
		const card = (top: number) => ({ top, bottom: top + 60 });
		expect(edgeSpeed(card(200), view, -80)).toBe(0);
		// At the top, carried up: up, from where the card is, not from how it moved.
		const edge = edgeSpeed(card(view.top + EDGE_PX - 1), view, -1);
		expect(edge).toBeLessThanOrEqual(-EDGE_SPEED.least);
		expect(edgeSpeed(card(view.top + EDGE_PX - 1), view, -300)).toBe(edge);
		expect(edgeSpeed(card(view.top + 10), view, -1)).toBeLessThan(edge);
		expect(edgeSpeed(card(view.top), view, -1)).toBe(-EDGE_SPEED.most);
		expect(edgeSpeed(card(view.top - 100), view, -1)).toBe(-EDGE_SPEED.most);
		// The bottom, the same way down.
		expect(edgeSpeed(card(view.bottom - 60), view, 1)).toBe(EDGE_SPEED.most);
		expect(edgeSpeed(card(view.bottom - 60 - EDGE_PX), view, 1)).toBe(0);
		// A card lifted at an edge and carried away from it, or not carried yet, scrolls nothing.
		expect(edgeSpeed(card(view.top), view, 30)).toBe(0);
		expect(edgeSpeed(card(view.bottom - 60), view, -30)).toBe(0);
		expect(edgeSpeed(card(view.top), view, 0)).toBe(0);
	});
});
