import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fit } from '../src/fit';

/**
 * A card fitted to what it holds (`fit.ts`, the witch doctor's right-hand
 * side, #166): as designed while it fits, then a step at a time only while
 * it is still too big, the steps in their order; and laid out as designed
 * again each time its words, its size or its font change, so a card never
 * keeps a step it no longer needs, nor misses one it does.
 */

const STEPS = ['close', 'small', 'bare'] as const;

/**
 * A card 200 px tall and 300 wide holding `need` px of height and `wide` px of
 * width as designed. Each step it takes gives back its share of `saves`.
 */
function card(need: number, wide = 300, saves = [20, 40, 30]) {
	const el = {
		dataset: {} as Record<string, string>,
		clientHeight: 200,
		clientWidth: 300,
		need,
		wide,
		get taken() {
			return (el.dataset.fit ?? '').split(' ').filter(Boolean);
		},
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
			observe() {}
			disconnect() {
				this.w.disconnected = true;
			}
		};
	vi.stubGlobal('ResizeObserver', watcher(watchers.resize));
	vi.stubGlobal('MutationObserver', watcher(watchers.words));
	vi.stubGlobal('document', { fonts });
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
