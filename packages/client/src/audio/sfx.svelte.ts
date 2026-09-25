import { CUES, type CueName } from './cues';
import { scheduleCue } from './synth';

/**
 * The game's sound: plays the cues in `cues.ts` when the screens ask, and
 * holds the Sound setting (DESIGN § Sound).
 *
 * - **Autoplay.** Browsers let a page make sound only after the player has
 *   pressed something. `unlock()`, called on every key press, click and touch
 *   (`main.ts`), creates the `AudioContext` the first time and resumes it
 *   whenever the browser has suspended it. `play()` never creates one, so a
 *   cue asked for before the first key press is silently dropped.
 * - **The setting.** `on` is remembered on this device
 *   (`localStorage['animath.sound']`, storage failures ignored) and is on by
 *   default. Turning it off cuts whatever is playing and suspends the context.
 * - **No WebAudio** (an old browser, a locked-down page): every call is a
 *   no-op and the game plays on in silence. A cue that fails to schedule is
 *   dropped, never thrown: a sound must never stop the game.
 *
 * Sound is never the only signal: every cue goes with something on screen,
 * and the screens call `play()` where they show it (UI_SPEC § Sound and juice).
 */

export const SOUND_STORAGE_KEY = 'animath.sound';
/** The level every cue is scaled by: modest, since kids play with the volume up. */
export const MASTER_VOLUME = 0.3;
/** How many recent cues `?debug` shows. */
const RECENT = 4;

export interface PlayOptions {
	/** Play this many times higher (2 is an octave up). */
	pitch?: number;
	/** Start this many seconds from now. */
	delay?: number;
}

export interface SfxOptions {
	/** Makes the context on the first unlock; null when there is no WebAudio. */
	createContext?: () => AudioContext | null;
	/** Where the setting is remembered; null when there is none. May throw. */
	storage?: () => Pick<Storage, 'getItem' | 'setItem'> | null;
}

export class Sfx {
	/** The Sound setting. */
	on = $state(true);
	/** The last few cues asked for, oldest first, audible or not: `?debug` shows them. */
	recent = $state<CueName[]>([]);
	/** Counts the times M flipped the setting; the sound chip shows each one. */
	flips = $state(0);

	private ctx: AudioContext | null = null;
	/** No WebAudio here: stop trying. */
	private unavailable = false;
	/** Every cue plays through this; replaced after a mute so nothing cut off comes back. */
	private master: GainNode | null = null;
	/** Keeps overlapping cues from clipping. Made once per context. */
	private limiter: DynamicsCompressorNode | null = null;
	private listeners = new Set<(cue: CueName) => void>();
	private createContext: () => AudioContext | null;
	private storage: () => Pick<Storage, 'getItem' | 'setItem'> | null;

	constructor(options: SfxOptions = {}) {
		this.createContext = options.createContext ?? browserContext;
		this.storage = options.storage ?? browserStorage;
		this.on = this.read() !== 'off';
	}

	/** Play a cue now (or after `delay`), if sound is on and the player has pressed something. */
	play(cue: CueName, options: PlayOptions = {}): void {
		this.recent = [...this.recent.slice(1 - RECENT), cue];
		for (const listener of this.listeners) listener(cue);
		const ctx = this.ctx;
		if (!this.on || !ctx || !this.master || ctx.state === 'closed') return;
		try {
			const start = ctx.currentTime + Math.max(0, options.delay ?? 0);
			scheduleCue(ctx, this.master, CUES[cue], start, options.pitch ?? 1);
		} catch {
			// Dropped: the game goes on without this sound.
		}
	}

	/** On a key press, click or touch: make the context if there is none, and wake it. */
	unlock(): void {
		if (!this.on || this.unavailable) return;
		if (!this.ctx) {
			this.ctx = this.createContext();
			if (!this.ctx) {
				this.unavailable = true;
				return;
			}
		}
		const ctx = this.ctx;
		try {
			if (!this.limiter) {
				this.limiter = ctx.createDynamicsCompressor();
				this.limiter.threshold.value = -12;
				this.limiter.knee.value = 12;
				this.limiter.ratio.value = 8;
				this.limiter.connect(ctx.destination);
			}
			if (!this.master) {
				this.master = ctx.createGain();
				this.master.gain.value = MASTER_VOLUME;
				this.master.connect(this.limiter);
			}
			if (ctx.state === 'suspended') Promise.resolve(ctx.resume()).catch(() => {});
		} catch {
			// A context that can't be set up plays nothing; the setting still holds.
		}
	}

	/** Turn sound on or off, and remember it on this device. */
	set(on: boolean): void {
		this.on = on;
		this.write(on ? 'on' : 'off');
		if (on) {
			this.unlock();
			return;
		}
		// Cut what is playing: its voices end in a node nothing listens to.
		this.master?.disconnect();
		this.master = null;
		if (this.ctx && this.ctx.state === 'running') {
			Promise.resolve(this.ctx.suspend()).catch(() => {});
		}
	}

	/** The M key: flip the setting, and let the sound chip say so. */
	flip(): void {
		this.set(!this.on);
		this.flips += 1;
	}

	/** Hear every cue asked for (tests, debugging). Returns the way to stop listening. */
	onCue(listener: (cue: CueName) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private read(): string | null {
		try {
			return this.storage()?.getItem(SOUND_STORAGE_KEY) ?? null;
		} catch {
			return null; // No storage: sound starts on.
		}
	}

	private write(value: 'on' | 'off'): void {
		try {
			this.storage()?.setItem(SOUND_STORAGE_KEY, value);
		} catch {
			// Not remembered on this device; the choice holds until the page reloads.
		}
	}
}

function browserContext(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	const Context =
		window.AudioContext ??
		(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!Context) return null;
	try {
		return new Context({ latencyHint: 'interactive' });
	} catch {
		return null;
	}
}

function browserStorage(): Storage | null {
	return typeof window === 'undefined' ? null : window.localStorage;
}

/** The page's one sound player. */
export const sfx = new Sfx();
