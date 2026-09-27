import type { Direction } from '@mathgame/engine';
import { isMashKey, PickGuard } from './pick-guard';
import { droppedBundle, tappedAnimal, tappedBundle, tappedOpen } from './press';

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
 * anything else as the browser names it ("Enter", "ArrowUp", "3", " ", and
 * "Process" while an input method is using the key, which is no W).
 */
export function keyName(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
	// One character is a letter, a digit or a sign; longer is a name.
	if ([...e.key].length !== 1) return e.key;
	const key = e.key.toLowerCase();
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

/**
 * What the party column was asked for, by a key or a pointer: a number key's
 * card (`place`, 0-based: the key 1 is the top card), a card clicked or
 * tapped, an animal on an open card, a card to open or close on a touch
 * screen, a card dropped at another place. The explore controller turns each
 * into a party intent, or opens the card.
 */
export type TeamPick =
	| { kind: 'place'; index: number }
	| { kind: 'bundle'; speciesId: string }
	| { kind: 'animal'; animalId: string }
	| { kind: 'open'; speciesId: string }
	| { kind: 'move'; speciesId: string; to: number };

/** Picks kept until explore's next frame takes them: a few, so a mash can't queue a long chain. */
const PICK_BUFFER = 4;

/**
 * Seconds of frame time Space must be held, with the glider, before it takes
 * off. A shorter press is a tap, which talks, chops or breaks as Space always
 * did ([[UI_SPEC]] § Explore mode). Long enough that a quick tap never flies,
 * short enough that a hold feels like a jump, with the trainer's wind-up
 * filling it.
 */
export const HOLD_TO_FLY = 0.25;

/** Which key asked to talk: Enter (and the touch controls' Talk), or a tap of Space. */
export type TalkKey = 'enter' | 'space';

/** The number keys 1 to 9 choose the card in that place (0-based), whose first animal standing goes first. */
function placeKey(key: string): number | undefined {
	return /^[1-9]$/.test(key) ? Number(key) - 1 : undefined;
}

/** What a pointer key of the party column asks for, if it is one. */
function pointerPick(key: string): TeamPick | undefined {
	const speciesId = tappedBundle(key);
	if (speciesId !== undefined) return { kind: 'bundle', speciesId };
	const animalId = tappedAnimal(key);
	if (animalId !== undefined) return { kind: 'animal', animalId };
	const open = tappedOpen(key);
	if (open !== undefined) return { kind: 'open', speciesId: open };
	const drop = droppedBundle(key);
	return drop && { kind: 'move', ...drop };
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
	/** The key that queued the last talk: Enter, or a tap of Space. */
	private talkedWith: TalkKey = 'enter';
	/** The player owns the glider: Space held flies, and only a tap of it talks. */
	private glider = false;
	/**
	 * Space held down with the glider, by its physical key: for how long, in
	 * frame seconds, and whether that hold has taken off. Let go before
	 * `HOLD_TO_FLY` it was a tap, and talks; once it has taken off, letting go
	 * lands. Null while Space is up (or was let go by a blur, a hidden page or
	 * a shortcut, which all count as letting go).
	 */
	private space: { code: string; held: number; flew: boolean } | null = null;
	/** Space was held long enough to take off, and explore has not taken that yet. */
	private takeOffQueued = false;
	/** What the party column was asked for since explore's last frame, oldest first. */
	private picks: TeamPick[] = [];
	/**
	 * Off until explore has the screen (`setEnabled`): a key pressed while the
	 * page loads or the title is up is never explore's.
	 */
	private enabled = false;
	/**
	 * Talk (Enter, Space) takes a quiet moment after explore takes the screen
	 * back and after every mashed key, as every choice does (`pick-guard.ts`):
	 * an Enter mashed through a result card, a doctor's goodbye or the title
	 * doesn't talk to the doctor behind it.
	 */
	private talk = new PickGuard();

	/**
	 * Releases are heard here, always: a key let go anywhere lets go of what
	 * it held. Presses come from `main.ts`, and only while explore has the
	 * screen (`keydown`).
	 */
	constructor(target: Window) {
		target.addEventListener('keyup', (e) => {
			const code = e.code || keyName(e);
			this.held.delete(code);
			// Space let go: a tap talks, as Space always did; a hold that flew lands.
			if (this.space?.code !== code) return;
			if (!this.space.flew && this.enabled) this.queueTalk('space');
			this.space = null;
		});
		// Away from the page, keys are let go where the page can't hear them.
		target.addEventListener('blur', () => this.clear());
		target.addEventListener('visibilitychange', () => this.clear());
	}

	/**
	 * A key pressed while explore has the screen. `main.ts` hands each key to
	 * exactly one screen, chosen before any of them acts on it, so the key
	 * that closes another screen (Continue, the result card, Bye) is never
	 * also a step or a word with the doctor.
	 */
	keydown(e: KeyboardEvent): void {
		// A shortcut is the browser's, and it stops the walk: macOS sends no
		// keyup for a key let go while Cmd is down, which would leave it held.
		// It lets go of Space too, so a glider in the air comes down.
		if (isShortcut(e)) {
			this.held.clear();
			this.space = null;
			this.takeOffQueued = false;
			return;
		}
		if (!this.enabled || e.repeat) return;
		const key = keyName(e);
		const dir = DIRECTION_KEYS[key];
		const fresh = isMashKey(key) ? this.talk.press() : this.talk.ready;
		if (dir) {
			this.held.set(e.code || key, { dir, since: performance.now() });
			if (this.taps.length < TAP_BUFFER) this.taps.push(dir);
			e.preventDefault();
		} else if (key === ' ' && this.glider) {
			// With the glider, Space is held to fly and tapped to talk: its release says
			// which. Within the quiet moment it is neither, as a talk would be nothing.
			if (fresh) this.space = { code: e.code || key, held: 0, flew: false };
			e.preventDefault();
		} else if (key === 'Enter' || key === ' ') {
			if (fresh) this.queueTalk(key === ' ' ? 'space' : 'enter');
			e.preventDefault();
		} else {
			const place = placeKey(key);
			const pick =
				place === undefined ? pointerPick(key) : { kind: 'place' as const, index: place };
			if (pick) {
				if (this.picks.length < PICK_BUFFER) this.picks.push(pick);
				e.preventDefault();
			}
		}
	}

	/** Frame time, from explore's `update`: Talk's quiet moment runs on it, and a Space hold. */
	tick(dt: number): void {
		this.talk.tick(dt);
		const space = this.space;
		if (space && !space.flew) {
			space.held += dt;
			if (space.held >= HOLD_TO_FLY) {
				space.flew = true;
				this.takeOffQueued = true;
			}
		}
	}

	/**
	 * Whether the player owns the glider: with it, Space held flies and a tap
	 * of Space talks on release; without it, Space talks as it goes down, as
	 * Enter does.
	 */
	setGlider(owned: boolean): void {
		if (this.glider === owned) return;
		this.glider = owned;
		this.space = null;
		this.takeOffQueued = false;
	}

	/**
	 * Explore input is only read in explore mode. Disabling drops whatever was
	 * held or buffered, so a key held into a battle does not walk the player
	 * when the battle ends, and keys typed in the battle never become steps.
	 * Enabling starts Talk's quiet moment: explore has just taken the screen.
	 */
	setEnabled(on: boolean): void {
		if (this.enabled === on) return;
		this.enabled = on;
		if (!on) this.clear();
		else this.talk.show();
	}

	private clear(): void {
		this.held.clear();
		this.taps.length = 0;
		this.interactQueued = false;
		this.picks.length = 0;
		this.space = null;
		this.takeOffQueued = false;
	}

	private queueTalk(key: TalkKey): void {
		this.interactQueued = true;
		this.talkedWith = key;
	}

	/** The next buffered tap, if any. Consumed once. */
	takeTap(): Direction | undefined {
		return this.taps.shift();
	}

	/**
	 * Forget the arrow taps pressed meanwhile: up in the air an arrow does
	 * nothing. One still held walks on from the landing tile, as after any step.
	 */
	dropTaps(): void {
		this.taps.length = 0;
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

	/** The key of the last talk taken: Enter, or a tap of Space (which says how to fly when there is nothing to say). */
	get talkKey(): TalkKey {
		return this.talkedWith;
	}

	/**
	 * Space has been held long enough to take off, and still is. Consumed
	 * once: one hold, one take-off; the next flight takes another press.
	 */
	takeTakeOff(): boolean {
		const v = this.takeOffQueued && this.space !== null;
		this.takeOffQueued = false;
		return v;
	}

	/** Space is held on after taking off: the glider stays up. Letting go, however it happens, lands. */
	flyHeld(): boolean {
		return this.space?.flew === true;
	}

	/** How far into a Space hold towards take-off, 0 to 1, for the trainer's wind-up; 0 when none. */
	windUp(): number {
		const space = this.space;
		return space && !space.flew ? Math.min(1, space.held / HOLD_TO_FLY) : 0;
	}

	/** The oldest thing the party column was asked for, if any. Consumed once. */
	takeTeamPick(): TeamPick | undefined {
		return this.picks.shift();
	}
}
