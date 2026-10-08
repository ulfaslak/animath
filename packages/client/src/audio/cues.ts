/**
 * The game's sounds, as data: every cue is a handful of short synthesized
 * voices (DESIGN § Sound). No audio files. `synth.ts` turns a cue into
 * WebAudio nodes; `sfx.svelte.ts` decides when one plays.
 *
 * The rules every cue keeps (`test/sfx.test.ts` checks them):
 *   - shorter than `MAX_CUE_SECONDS`, tail included;
 *   - soft waveforms (sine and triangle; noise only through a filter);
 *   - gentle levels: no voice louder than `MAX_VOICE_GAIN` before the master volume;
 *   - an envelope that starts and ends at silence, so nothing clicks.
 * Good things rise and sit in a major key. A wrong answer is one soft low
 * "bonk" — never a buzzer, never a falling "wah-wah" that could sound like
 * teasing.
 */

export type CueName =
	| 'encounter'
	| 'move'
	| 'confirm'
	| 'correct'
	| 'wrong'
	| 'hit'
	| 'faint'
	| 'throw'
	| 'wobble'
	| 'caught'
	| 'boing'
	| 'heal'
	| 'coins'
	| 'lead'
	| 'won'
	| 'chop'
	| 'crack'
	| 'shatter'
	| 'cast'
	| 'splash'
	| 'travel'
	| 'whoosh'
	| 'land'
	| 'squawk';

export type Wave = 'sine' | 'triangle' | 'noise';

export interface Voice {
	/** Seconds after the cue starts. */
	at: number;
	/** Seconds from the voice's start to silence (attack, hold and decay). */
	dur: number;
	wave: Wave;
	/** Hz: the pitch of an oscillator. Noise has no pitch; its `filter` colours it. */
	freq: number;
	/** Hz at the end of the voice: an exponential glide from `freq`. */
	to?: number;
	/** Peak level, before the master volume. */
	gain: number;
	/** Seconds from silence to the peak. Default `DEFAULT_ATTACK`. */
	attack?: number;
	/** Seconds held at the peak before the decay. Default 0: a pluck. */
	hold?: number;
	/** A filter on the voice; `to` glides its frequency like the pitch. */
	filter?: { type: 'lowpass' | 'bandpass' | 'highpass'; freq: number; to?: number; q?: number };
	/** A wobble in pitch: `rate` Hz, `depth` a fraction of the pitch, fading out over the voice. */
	vibrato?: { rate: number; depth: number };
}

export interface Cue {
	voices: readonly Voice[];
}

/** No cue lasts longer than this, in seconds, tail included. */
export const MAX_CUE_SECONDS = 1.2;
/** The loudest a single voice may be, before the master volume. */
export const MAX_VOICE_GAIN = 0.6;
/** Seconds a voice takes to rise from silence when it says nothing else. */
export const DEFAULT_ATTACK = 0.005;
/** Seconds an oscillator runs past its decay, so it stops in silence. */
export const TAIL_SECONDS = 0.02;

/** Equal temperament, A4 = 440 Hz. */
const hz = (semitonesFromA4: number) => 440 * 2 ** (semitonesFromA4 / 12);
const C4 = hz(-9);
const G4 = hz(-2);
const C5 = hz(3);
const E5 = hz(7);
const G5 = hz(10);
const A5 = hz(12);
const C6 = hz(15);
const D6 = hz(17);
const E6 = hz(19);
const G6 = hz(22);
const C7 = hz(27);
const E7 = hz(31);

/** A plucked note: quick rise, then a decay to silence over `dur`. */
function pluck(
	at: number,
	freq: number,
	dur: number,
	gain: number,
	wave: Wave = 'triangle'
): Voice {
	return { at, dur, wave, freq, gain };
}

/** A held note: rises, stays for `hold` seconds, then fades over the rest of `dur`. */
function held(
	at: number,
	freq: number,
	dur: number,
	hold: number,
	gain: number,
	wave: Wave = 'triangle'
): Voice {
	return { at, dur, wave, freq, gain, attack: 0.01, hold };
}

export const CUES: Record<CueName, Cue> = {
	/** A wild animal jumps out: a quick rising run with a little whoosh under it. */
	encounter: {
		voices: [
			pluck(0, G4, 0.16, 0.3),
			pluck(0.06, C5, 0.16, 0.3),
			pluck(0.12, E5, 0.16, 0.3),
			pluck(0.18, G5, 0.16, 0.3),
			held(0.24, C6, 0.32, 0.06, 0.3),
			{ at: 0, dur: 0.3, wave: 'sine', freq: 300, to: 900, gain: 0.1, attack: 0.08 }
		]
	},
	/** The cursor moves: the smallest blip, quieter than everything else. */
	move: {
		voices: [
			{ at: 0, dur: 0.07, wave: 'triangle', freq: A5, gain: 0.3, attack: 0.004, hold: 0.012 }
		]
	},
	/** A choice is made: two quick notes up. */
	confirm: { voices: [pluck(0, E5, 0.07, 0.24), pluck(0.05, A5, 0.1, 0.24)] },
	/** A right answer: a bright chime, three bells up a major chord. */
	correct: {
		voices: [
			pluck(0, C6, 0.5, 0.26, 'sine'),
			pluck(0.07, E6, 0.5, 0.24, 'sine'),
			pluck(0.14, G6, 0.55, 0.24, 'sine'),
			pluck(0.14, C7, 0.3, 0.06)
		]
	},
	/**
	 * A miss: one soft, round, low bonk. Pitched above 200 Hz so a laptop's
	 * small speakers still carry it; one note, never a falling pair.
	 */
	wrong: {
		voices: [
			{
				at: 0,
				dur: 0.24,
				wave: 'sine',
				freq: 300,
				to: 210,
				gain: 0.3,
				attack: 0.01,
				hold: 0.03,
				filter: { type: 'lowpass', freq: 1000 }
			},
			{ at: 0, dur: 0.18, wave: 'triangle', freq: 150, to: 110, gain: 0.15, attack: 0.01 }
		]
	},
	/**
	 * An attack lands: a thump with a knock on top that small speakers can
	 * play (they drop the thump's lowest notes), and a puff of air.
	 */
	hit: {
		voices: [
			{ at: 0, dur: 0.18, wave: 'sine', freq: 220, to: 80, gain: 0.55, attack: 0.003 },
			{ at: 0, dur: 0.07, wave: 'triangle', freq: 330, to: 160, gain: 0.3, attack: 0.002 },
			{
				at: 0,
				dur: 0.08,
				wave: 'noise',
				freq: 0,
				gain: 0.22,
				attack: 0.003,
				filter: { type: 'lowpass', freq: 1200, to: 300 }
			}
		]
	},
	/** An animal gets tired and lies down: a soft puff that sinks. */
	faint: {
		voices: [
			{
				at: 0,
				dur: 0.55,
				wave: 'noise',
				freq: 0,
				gain: 0.3,
				attack: 0.05,
				filter: { type: 'bandpass', freq: 1400, to: 300, q: 0.8 }
			},
			{ at: 0, dur: 0.5, wave: 'sine', freq: 520, to: 200, gain: 0.16, attack: 0.03 }
		]
	},
	/** The leash flies: a whoosh that rises. */
	throw: {
		voices: [
			{
				at: 0,
				dur: 0.35,
				wave: 'noise',
				freq: 0,
				gain: 0.3,
				attack: 0.08,
				filter: { type: 'bandpass', freq: 500, to: 2500, q: 1.2 }
			},
			{ at: 0, dur: 0.3, wave: 'sine', freq: 300, to: 700, gain: 0.07, attack: 0.05 }
		]
	},
	/**
	 * The loop wobbles on the animal: tick, tock, tick, tock, at the pace of
	 * its swing (one way every 0.35 s, `battle-scene.ts`).
	 */
	wobble: {
		voices: [
			pluck(0, 1100, 0.035, 0.18),
			pluck(0.35, 850, 0.035, 0.18),
			pluck(0.7, 1100, 0.035, 0.18),
			pluck(1.05, 850, 0.035, 0.18)
		]
	},
	/** The leash holds: a little fanfare up to a held note. */
	caught: {
		voices: [
			pluck(0, C5, 0.12, 0.28),
			pluck(0.1, E5, 0.12, 0.28),
			pluck(0.2, G5, 0.12, 0.28),
			held(0.3, C6, 0.75, 0.3, 0.3),
			held(0.3, G5, 0.7, 0.3, 0.1, 'sine'),
			held(0.3, E5, 0.7, 0.3, 0.1, 'sine')
		]
	},
	/** The animal slips the loop: a gentle spring. */
	boing: {
		voices: [
			{
				at: 0,
				dur: 0.45,
				wave: 'sine',
				freq: 260,
				to: 360,
				gain: 0.32,
				attack: 0.01,
				vibrato: { rate: 14, depth: 0.25 }
			}
		]
	},
	/** The doctor heals: a sparkle of high bells over a warm note. */
	heal: {
		voices: [
			pluck(0, C5, 0.6, 0.12, 'sine'),
			pluck(0, E6, 0.25, 0.14, 'sine'),
			pluck(0.05, G6, 0.25, 0.14, 'sine'),
			pluck(0.1, C7, 0.25, 0.12, 'sine'),
			pluck(0.15, E7, 0.3, 0.08, 'sine'),
			pluck(0.2, C7, 0.3, 0.04)
		]
	},
	/** Tokens change hands at the doctor: bright little coins clinking up, over a soft note. */
	coins: {
		voices: [
			pluck(0, C6, 0.3, 0.1, 'sine'),
			pluck(0, E6, 0.09, 0.2, 'sine'),
			pluck(0.07, G6, 0.09, 0.2, 'sine'),
			pluck(0.14, C7, 0.09, 0.18, 'sine'),
			pluck(0.21, E7, 0.28, 0.12, 'sine')
		]
	},
	/** A new animal goes first: ding-ding! */
	lead: { voices: [pluck(0, G5, 0.1, 0.24), pluck(0.08, D6, 0.22, 0.24)] },
	/** The battle is won: da-da-da, da-daaa. */
	won: {
		voices: [
			pluck(0, C5, 0.1, 0.26),
			pluck(0.1, E5, 0.1, 0.26),
			pluck(0.2, G5, 0.1, 0.26),
			pluck(0.32, E5, 0.1, 0.26),
			held(0.42, G5, 0.7, 0.25, 0.28),
			held(0.42, C5, 0.7, 0.25, 0.1, 'sine'),
			held(0.42, C4, 0.7, 0.25, 0.14, 'sine')
		]
	},
	/**
	 * The axe bites: a woody knock with a click of the blade on top, and as
	 * the tree comes down a soft thud and a rustle of its needles.
	 */
	chop: {
		voices: [
			{ at: 0, dur: 0.09, wave: 'triangle', freq: 520, to: 260, gain: 0.34, attack: 0.002 },
			{
				at: 0,
				dur: 0.05,
				wave: 'noise',
				freq: 0,
				gain: 0.26,
				attack: 0.002,
				filter: { type: 'bandpass', freq: 2200, to: 900, q: 1.5 }
			},
			{ at: 0.42, dur: 0.22, wave: 'sine', freq: 150, to: 70, gain: 0.3, attack: 0.004 },
			{
				at: 0.4,
				dur: 0.28,
				wave: 'noise',
				freq: 0,
				gain: 0.14,
				attack: 0.03,
				filter: { type: 'lowpass', freq: 1800, to: 500 }
			}
		]
	},
	/**
	 * The pickaxe cracks a rock: a sharp crack over a low thump, then the
	 * pebbles ticking down round it.
	 */
	crack: {
		voices: [
			{
				at: 0,
				dur: 0.07,
				wave: 'noise',
				freq: 0,
				gain: 0.32,
				attack: 0.002,
				filter: { type: 'bandpass', freq: 3000, to: 1200, q: 2 }
			},
			{ at: 0, dur: 0.14, wave: 'sine', freq: 190, to: 90, gain: 0.34, attack: 0.003 },
			pluck(0.2, 1800, 0.04, 0.12),
			pluck(0.27, 2300, 0.04, 0.1),
			pluck(0.34, 2000, 0.04, 0.09)
		]
	},
	/**
	 * The ice pick breaks an ice block: a bright glassy crack, then the shards
	 * tinkling down, higher and lighter than a rock's pebbles.
	 */
	shatter: {
		voices: [
			{
				at: 0,
				dur: 0.06,
				wave: 'noise',
				freq: 0,
				gain: 0.28,
				attack: 0.002,
				filter: { type: 'highpass', freq: 2600, to: 4200, q: 1 }
			},
			{ at: 0, dur: 0.1, wave: 'sine', freq: 260, to: 140, gain: 0.22, attack: 0.003 },
			pluck(0.12, 3100, 0.06, 0.1, 'sine'),
			pluck(0.18, 3300, 0.05, 0.09, 'sine'),
			pluck(0.25, 3500, 0.05, 0.08, 'sine'),
			pluck(0.33, 3700, 0.05, 0.06, 'sine')
		]
	},
	/** A line cast at a fishing hole: the rod's swish, then a little plop as the bobber lands. */
	cast: {
		voices: [
			{
				at: 0.1,
				dur: 0.25,
				wave: 'noise',
				freq: 0,
				gain: 0.14,
				attack: 0.05,
				filter: { type: 'bandpass', freq: 1400, to: 3200, q: 1.2 }
			},
			{ at: 0.58, dur: 0.12, wave: 'sine', freq: 620, to: 300, gain: 0.22, attack: 0.004 }
		]
	},
	/** Something bit: the bobber goes under with a splash and a bright "bloop". */
	splash: {
		voices: [
			{
				at: 0,
				dur: 0.3,
				wave: 'noise',
				freq: 0,
				gain: 0.22,
				attack: 0.01,
				filter: { type: 'lowpass', freq: 2400, to: 600 }
			},
			{ at: 0, dur: 0.16, wave: 'sine', freq: 300, to: 700, gain: 0.26, attack: 0.004 },
			pluck(0.18, E6, 0.14, 0.12, 'sine')
		]
	},
	/**
	 * Off to another world: a soft whoosh rising into the sky while the world
	 * closes round the trainer, then a bright chord as the new one opens.
	 */
	travel: {
		voices: [
			{
				at: 0,
				dur: 0.5,
				wave: 'noise',
				freq: 0,
				gain: 0.2,
				attack: 0.2,
				filter: { type: 'bandpass', freq: 400, to: 3000, q: 1 }
			},
			{ at: 0, dur: 0.5, wave: 'sine', freq: 220, to: 880, gain: 0.08, attack: 0.15 },
			pluck(0.55, C6, 0.4, 0.18, 'sine'),
			pluck(0.62, E6, 0.4, 0.16, 'sine'),
			pluck(0.69, G6, 0.45, 0.16, 'sine'),
			pluck(0.76, C7, 0.35, 0.08)
		]
	},
	/**
	 * Up and away with the glider: a rush of air rising as the canopy fills,
	 * and a soft rising tone with it.
	 */
	whoosh: {
		voices: [
			{
				at: 0,
				dur: 0.6,
				wave: 'noise',
				freq: 0,
				gain: 0.22,
				attack: 0.15,
				filter: { type: 'bandpass', freq: 350, to: 1800, q: 0.9 }
			},
			{ at: 0.02, dur: 0.45, wave: 'sine', freq: 330, to: 660, gain: 0.07, attack: 0.1 }
		]
	},
	/** Down on the ground: a soft thud of feet on grass, and a small happy two-note settle. */
	land: {
		voices: [
			{
				at: 0,
				dur: 0.16,
				wave: 'noise',
				freq: 0,
				gain: 0.2,
				attack: 0.01,
				filter: { type: 'lowpass', freq: 500, to: 220 }
			},
			pluck(0.06, G5, 0.14, 0.12, 'sine'),
			pluck(0.13, C6, 0.2, 0.12, 'sine')
		]
	},
	/**
	 * A bird noticed the glider (#91): a high mewing cry, as a buzzard calls
	 * over the fields, gliding down and wavering, twice, the second shorter;
	 * a little breath of wind under it. Surprised, never scary.
	 */
	squawk: {
		voices: [
			{
				at: 0,
				dur: 0.34,
				wave: 'triangle',
				freq: 1480,
				to: 980,
				gain: 0.2,
				attack: 0.03,
				hold: 0.08,
				vibrato: { rate: 18, depth: 0.03 }
			},
			{
				at: 0.36,
				dur: 0.22,
				wave: 'triangle',
				freq: 1320,
				to: 1000,
				gain: 0.16,
				attack: 0.02,
				hold: 0.04,
				vibrato: { rate: 18, depth: 0.03 }
			},
			{
				at: 0,
				dur: 0.3,
				wave: 'noise',
				freq: 0,
				gain: 0.05,
				attack: 0.08,
				filter: { type: 'bandpass', freq: 2400, to: 1200, q: 1.2 }
			}
		]
	}
};

export const CUE_NAMES = Object.keys(CUES) as CueName[];

/** Seconds from a cue's start until its last voice has stopped. */
export function cueSeconds(cue: Cue): number {
	return Math.max(0, ...cue.voices.map((v) => v.at + v.dur + TAIL_SECONDS));
}

/** How much higher a cue plays for an attack's level: easy as written, medium a third up, hard a fifth. */
export function levelPitch(level: 1 | 2 | 3): number {
	return 2 ** ([0, 4, 7][level - 1]! / 12);
}
