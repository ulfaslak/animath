import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fit } from '../src/fit';

/**
 * A card fitted to what it holds (`fit.ts`, the druid's right-hand
 * side, #166): as designed while it fits, then a step at a time only while
 * it is still too big, the steps in their order; and laid out as designed
 * again each time its words, its size or its font change, so a card never
 * keeps a step it no longer needs, nor misses one it does.
 */

const STEPS = ['close', 'small', 'bare'] as const;

/** Where a piece of the card is drawn on the screen, a fraction of a pixel included. */
interface Box {
	left: number;
	right: number;
	top: number;
	bottom: number;
	width: number;
	height: number;
}
const at = (top: number, bottom: number, left = 20, right = 280): Box => ({
	left,
	right,
	top,
	bottom,
	width: right - left,
	height: bottom - top
});
/** A piece the card holds, drawn where `place` says for the steps taken. */
type Piece = (taken: string[]) => Box;

/**
 * A card 200 px tall and 300 wide, at the screen's top left, holding `need` px
 * of height and `wide` px of width as designed, and `pieces` drawn where each
 * says. Each step it takes gives back its share of `saves`.
 */
function card(need: number, wide = 300, saves = [20, 40, 30], pieces: Piece[] = []) {
	const el = {
		dataset: {} as Record<string, string>,
		clientHeight: 200,
		clientWidth: 300,
		need,
		wide,
		pieces,
		get taken() {
			return (el.dataset.fit ?? '').split(' ').filter(Boolean);
		},
		getBoundingClientRect: () => at(0, el.clientHeight, 0, el.clientWidth),
		querySelectorAll: () =>
			el.pieces.map((place) => ({ getBoundingClientRect: () => place(el.taken) })),
		get scrollHeight() {
			const given = saves.slice(0, el.taken.length).reduce((a, b) => a + b, 0);
			return Math.max(el.clientHeight, el.need - given);
		},
		get scrollWidth() {
			return Math.max(el.clientWidth, el.wide - (el.taken.includes('small') ? 40 : 0));
		}
	};
	return el;
}

/** The watchers `fit` sets up, stood in for: each keeps its callback to call as the page would. */
const watchers = { resize: [] as Watcher[], words: [] as Watcher[] };
interface Watcher {
	call: () => void;
	disconnected: boolean;
	options?: unknown;
}
const fonts = new EventTarget();

beforeEach(() => {
	watchers.resize = [];
	watchers.words = [];
	const watcher = (list: Watcher[]) =>
		class {
			w: Watcher;
			constructor(callback: () => void) {
				this.w = { call: callback, disconnected: false };
				list.push(this.w);
			}
			observe(_target: unknown, options?: unknown) {
				this.w.options = options;
			}
			disconnect() {
				this.w.disconnected = true;
			}
		};
	vi.stubGlobal('ResizeObserver', watcher(watchers.resize));
	vi.stubGlobal('MutationObserver', watcher(watchers.words));
	vi.stubGlobal('document', { fonts });
	vi.stubGlobal('getComputedStyle', () => ({
		borderLeftWidth: '0px',
		borderRightWidth: '0px',
		borderTopWidth: '0px',
		borderBottomWidth: '0px'
	}));
});
afterEach(() => vi.unstubAllGlobals());

function attach(el: ReturnType<typeof card>) {
	return fit(STEPS)(el as unknown as HTMLElement);
}

describe('a fitted card', () => {
	it('keeps its designed look while what it holds fits', () => {
		const el = card(200);
		attach(el);
		expect(el.dataset.fit).toBeUndefined();
	});

	it('takes the steps in their order, and only while it is still too big', () => {
		const tall = card(250);
		attach(tall);
		// 250 → 230 after `close`, still too tall; 190 after `small`: fits, so no `bare`.
		expect(tall.dataset.fit).toBe('close small');

		const wide = card(200, 330);
		attach(wide);
		// Too wide until `small` gives back 40 px across.
		expect(wide.dataset.fit).toBe('close small');
	});

	it('takes a step for a piece past any side, which the scroll size does not see', () => {
		// The scroll size is a whole number and counts only down and to the right: a card that
		// centres what it holds runs it up past its top, and a pixel past the bottom is inside
		// the scroll size's slack (#250: Hint 1.1 px past a druid's card on a phone).
		const up = card(200, 300, [20, 40, 30], [(taken) => (taken.length ? at(0, 40) : at(-8, 32))]);
		attach(up);
		expect(up.dataset.fit).toBe('close');

		const left = card(
			200,
			300,
			[20, 40, 30],
			[(taken) => (taken.includes('small') ? at(80, 120, 4, 296) : at(80, 120, -3, 303))]
		);
		attach(left);
		expect(left.dataset.fit).toBe('close small');

		const down = card(
			200,
			300,
			[20, 40, 30],
			[(taken) => (taken.length ? at(160, 199) : at(161.1, 201.1))]
		);
		attach(down);
		expect(down.dataset.fit).toBe('close');
	});

	it('takes no step for half a pixel, nor for a piece not drawn', () => {
		// What `doctor-fit.mjs` lets through, so the two agree on what fits.
		const half = card(200, 300, [20, 40, 30], [() => at(160.6, 200.4)]);
		attach(half);
		expect(half.dataset.fit).toBeUndefined();

		// Put away (`display: none`), a piece has no size, wherever it would be.
		const away = card(200, 300, [20, 40, 30], [() => at(-50, -50, -50, -50)]);
		attach(away);
		expect(away.dataset.fit).toBeUndefined();
	});

	it('stops after the last step, whatever still does not fit', () => {
		const el = card(400);
		attach(el);
		expect(el.dataset.fit).toBe('close small bare');
	});

	it('fits again from its designed look when its words, its size or its font change', () => {
		const el = card(250);
		attach(el);
		expect(el.dataset.fit).toBe('close small');

		// Its words: shorter now, so it gives the steps back.
		el.need = 180;
		watchers.words[0]!.call();
		expect(el.dataset.fit).toBeUndefined();

		// Its size: a taller doctor's line over it leaves it less room.
		el.clientHeight = 150;
		watchers.resize[0]!.call();
		expect(el.dataset.fit).toBe('close small');

		// Its font: Nunito arrived, and the words take more room than in the stand-in.
		el.need = 300;
		fonts.dispatchEvent(new Event('loadingdone'));
		expect(el.dataset.fit).toBe('close small bare');
	});

	it('watches its outer size, which no step changes', () => {
		// A step's padding changes the content box: watching that, each refit resized the card
		// it had just fitted, and WebKit reported a ResizeObserver loop.
		attach(card(250));
		expect(watchers.resize[0]!.options).toEqual({ box: 'border-box' });
	});

	it('lets go of its watchers when the card goes', () => {
		const el = card(250);
		const gone = attach(el);
		gone();
		expect([...watchers.resize, ...watchers.words].every((w) => w.disconnected)).toBe(true);
		el.need = 180;
		fonts.dispatchEvent(new Event('loadingdone'));
		expect(el.dataset.fit).toBe('close small');
	});
});
