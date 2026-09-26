import { MAX_PARTY, type Direction } from '@mathgame/engine';

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

/** W A S D by where a QWERTY keyboard has them, for keyboards whose letters aren't Latin. */
const WASD_BY_POSITION: Record<string, string> = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd' };

/**
 * The name every screen's key map reads for a key press: a letter in lower
 * case whatever Caps Lock and Shift say ("D" is "d"); on a keyboard that
 * types another alphabet (Russian, Greek), W A S D by where they sit; and
 * anything else as the browser names it ("Enter", "ArrowUp", "3", " ").
 */
export function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	if (/^[a-z]$/.test(key)) return key;
	return WASD_BY_POSITION[e.code] ?? key;
}

/**
 * A browser shortcut: a key pressed with Ctrl, Cmd or Alt held (bookmark,
 * save, select all, back). The game uses none of them, so every screen
 * leaves them to the browser.
 */
export function isShortcut(e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean {
	return e.ctrlKey || e.metaKey || e.altKey;
}

/**
 * Tracks held keys so movement repeats while a key is down, and buffers taps
 * so a press shorter than one frame still produces one step (Game Boy feel:
 * a tap always moves one tile). The buffer is capped so mashing can't queue
 * a long walk the player no longer wants.
 */
const TAP_BUFFER = 2;

/** The number keys 1 to `MAX_PARTY` choose the party slot that goes first. */
function slotKey(key: string): number | undefined {
	const n = /^[1-9]$/.test(key) ? Number(key) : 0;
	return n >= 1 && n <= MAX_PARTY ? n - 1 : undefined;
}

export class Keyboard {
	/**
	 * Direction keys held down, by the physical key (`code`), so a key's
	 * release lets go of whatever its press held, even when the two name the
	 * key differently: a D let go while Shift is down reports "D".
	 */
	private held = new Map<string, { dir: Direction; since: number }>();
	private taps: Direction[] = [];
	private interactQueued = false;
	/** The party slot (0-based) whose number was pressed last, until it is taken. */
	private slotQueued: number | undefined;
	private enabled = true;

	constructor(target: Window) {
		target.addEventListener('keydown', (e) => {
			// A shortcut is the browser's, and it stops the walk: macOS sends no
			// keyup for a key let go while Cmd is down, which would leave it held.
			if (isShortcut(e)) {
				this.held.clear();
				return;
			}
			if (!this.enabled || e.repeat) return;
			const key = keyName(e);
			const dir = DIRECTION_KEYS[key];
			if (dir) {
				this.held.set(e.code || key, { dir, since: performance.now() });
				if (this.taps.length < TAP_BUFFER) this.taps.push(dir);
				e.preventDefault();
			} else if (key === 'Enter' || key === ' ') {
				this.interactQueued = true;
				e.preventDefault();
			} else if (slotKey(key) !== undefined) {
				this.slotQueued = slotKey(key);
				e.preventDefault();
			}
		});
		target.addEventListener('keyup', (e) => {
			this.held.delete(e.code || keyName(e));
		});
		// Away from the page, keys are let go where the page can't hear them.
		target.addEventListener('blur', () => this.clear());
		target.addEventListener('visibilitychange', () => this.clear());
	}

	/**
	 * Explore input is only read in explore mode. Disabling drops whatever was
	 * held or buffered, so a key held into a battle does not walk the player
	 * when the battle ends, and keys typed in the battle never become steps.
	 */
	setEnabled(on: boolean): void {
		if (this.enabled === on) return;
		this.enabled = on;
		if (!on) this.clear();
	}

	private clear(): void {
		this.held.clear();
		this.taps.length = 0;
		this.interactQueued = false;
		this.slotQueued = undefined;
	}

	/** The next buffered tap, if any. Consumed once. */
	takeTap(): Direction | undefined {
		return this.taps.shift();
	}

	/** The most recently pressed direction still held, if any. */
	heldDirection(): Direction | undefined {
		let best: Direction | undefined;
		let bestSince = -1;
		for (const { dir, since } of this.held.values()) {
			if (since > bestSince) {
				best = dir;
				bestSince = since;
			}
		}
		return best;
	}

	takeInteract(): boolean {
		const v = this.interactQueued;
		this.interactQueued = false;
		return v;
	}

	/** The party slot (0-based) the player asked to go first, if any. Consumed once. */
	takeSlot(): number | undefined {
		const slot = this.slotQueued;
		this.slotQueued = undefined;
		return slot;
	}
}
