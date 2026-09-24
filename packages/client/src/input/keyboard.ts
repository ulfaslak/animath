import type { Direction } from '@mathgame/engine';

const DIRECTION_KEYS: Record<string, Direction> = {
	ArrowUp: 'up',
	ArrowDown: 'down',
	ArrowLeft: 'left',
	ArrowRight: 'right',
	w: 'up',
	s: 'down',
	a: 'left',
	d: 'right'
};

/**
 * Tracks held keys so movement repeats while a key is down, and buffers taps
 * so a press shorter than one frame still produces one step (Game Boy feel:
 * a tap always moves one tile). The buffer is capped so mashing can't queue
 * a long walk the player no longer wants.
 */
const TAP_BUFFER = 2;

export class Keyboard {
	private held = new Map<Direction, number>(); // dir → time pressed
	private taps: Direction[] = [];
	private interactQueued = false;

	constructor(target: Window) {
		target.addEventListener('keydown', (e) => {
			if (e.repeat) return;
			const dir = DIRECTION_KEYS[e.key];
			if (dir) {
				this.held.set(dir, performance.now());
				if (this.taps.length < TAP_BUFFER) this.taps.push(dir);
				e.preventDefault();
			} else if (e.key === 'Enter' || e.key === ' ') {
				this.interactQueued = true;
				e.preventDefault();
			}
		});
		target.addEventListener('keyup', (e) => {
			const dir = DIRECTION_KEYS[e.key];
			if (dir) this.held.delete(dir);
		});
		target.addEventListener('blur', () => {
			this.held.clear();
			this.taps.length = 0;
		});
	}

	/** The next buffered tap, if any. Consumed once. */
	takeTap(): Direction | undefined {
		return this.taps.shift();
	}

	/** The most recently pressed direction still held, if any. */
	heldDirection(): Direction | undefined {
		let best: Direction | undefined;
		let bestT = -1;
		for (const [dir, t] of this.held) {
			if (t > bestT) {
				best = dir;
				bestT = t;
			}
		}
		return best;
	}

	takeInteract(): boolean {
		const v = this.interactQueued;
		this.interactQueued = false;
		return v;
	}
}
