import { describe, expect, it } from 'vitest';
import {
	CUE_NAMES,
	CUES,
	MAX_CUE_SECONDS,
	MAX_VOICE_GAIN,
	cueSeconds,
	levelPitch,
	type CueName
} from '../src/audio/cues';
import { MASTER_VOLUME, SOUND_STORAGE_KEY, Sfx } from '../src/audio/sfx.svelte';
import { scheduleCue } from '../src/audio/synth';

/**
 * The sound, without a speaker: the cues as data (short, gentle, silent at
 * both ends), the scheduler against an instrumented stand-in for WebAudio
 * (what it creates, connects, starts and stops, and every level it sets), and
 * the player's rules — no context before a key press, the setting remembered,
 * a muted game schedules nothing, a page without WebAudio plays on. Whether a
 * cue *sounds* right is for ears; that it is not silent is checked by an
 * `OfflineAudioContext` render in a real browser (DEVELOPMENT § Hearing the game).
 */

type Event = { method: string; value: number; time: number };

class FakeParam {
	value: number;
	events: Event[] = [];
	constructor(value = 0) {
		this.value = value;
	}
	setValueAtTime(value: number, time: number) {
		this.events.push({ method: 'set', value, time });
		return this;
	}
	linearRampToValueAtTime(value: number, time: number) {
		this.events.push({ method: 'linear', value, time });
		return this;
	}
	exponentialRampToValueAtTime(value: number, time: number) {
		if (value <= 0) throw new RangeError('exponential ramp to a value <= 0');
		this.events.push({ method: 'exponential', value, time });
		return this;
	}
}

class FakeNode {
	outputs: unknown[] = [];
	constructor(
		readonly kind: string,
		readonly ctx: FakeContext
	) {
		ctx.nodes.push(this);
	}
	connect(target: unknown) {
		this.outputs.push(target);
		return target;
	}
	disconnect() {
		this.outputs = [];
	}
}

class FakeSource extends FakeNode {
	started: number | null = null;
	stopped: number | null = null;
	onended: (() => void) | null = null;
	start(time: number) {
		this.started = time;
	}
	stop(time: number) {
		this.stopped = time;
	}
}

class FakeOscillator extends FakeSource {
	type = 'sine';
	frequency = new FakeParam(440);
	constructor(ctx: FakeContext) {
		super('oscillator', ctx);
	}
}

class FakeBufferSource extends FakeSource {
	buffer: unknown = null;
	loop = false;
	constructor(ctx: FakeContext) {
		super('buffer', ctx);
	}
}

class FakeGain extends FakeNode {
	gain = new FakeParam(1);
	constructor(ctx: FakeContext) {
		super('gain', ctx);
	}
}

class FakeFilter extends FakeNode {
	type = 'lowpass';
	frequency = new FakeParam(350);
	Q = new FakeParam(1);
	constructor(ctx: FakeContext) {
		super('filter', ctx);
	}
}

class FakeCompressor extends FakeNode {
	threshold = new FakeParam(-24);
	knee = new FakeParam(30);
	ratio = new FakeParam(12);
	constructor(ctx: FakeContext) {
		super('compressor', ctx);
	}
}

class FakeContext {
	nodes: FakeNode[] = [];
	state: 'suspended' | 'running' | 'closed' = 'suspended';
	currentTime = 0;
	sampleRate = 8000;
	destination: FakeNode;
	resumes = 0;
	suspends = 0;
	constructor() {
		this.destination = new FakeNode('destination', this);
	}
	createOscillator() {
		return new FakeOscillator(this);
	}
	createBufferSource() {
		return new FakeBufferSource(this);
	}
	createGain() {
		return new FakeGain(this);
	}
	createBiquadFilter() {
		return new FakeFilter(this);
	}
	createDynamicsCompressor() {
		return new FakeCompressor(this);
	}
	createBuffer(_channels: number, length: number) {
		const data = new Float32Array(length);
		return { getChannelData: () => data };
	}
	resume() {
		this.resumes++;
		this.state = 'running';
		return Promise.resolve();
	}
	suspend() {
		this.suspends++;
		this.state = 'suspended';
		return Promise.resolve();
	}
	sources(): FakeSource[] {
		return this.nodes.filter((n): n is FakeSource => n instanceof FakeSource);
	}
}

const asContext = (ctx: FakeContext) => ctx as unknown as AudioContext;

/** Every node `from` feeds, directly or through others. */
function reaches(from: unknown, target: unknown, seen = new Set<unknown>()): boolean {
	if (from === target) return true;
	if (seen.has(from) || !(from instanceof FakeNode)) return false;
	seen.add(from);
	return from.outputs.some((next) => reaches(next, target, seen));
}

function memoryStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value)
	};
}

describe('cues', () => {
	it('lists every cue the screens use', () => {
		expect([...CUE_NAMES].sort()).toEqual(
			[
				'boing',
				'caught',
				'coins',
				'confirm',
				'correct',
				'encounter',
				'faint',
				'heal',
				'hit',
				'lead',
				'move',
				'throw',
				'wobble',
				'won',
				'wrong'
			].sort()
		);
	});

	for (const name of CUE_NAMES) {
		it(`${name}: short, gentle, with time to fade`, () => {
			const cue = CUES[name];
			expect(cue.voices.length).toBeGreaterThan(0);
			expect(cueSeconds(cue)).toBeLessThanOrEqual(MAX_CUE_SECONDS);
			for (const v of cue.voices) {
				expect(v.at).toBeGreaterThanOrEqual(0);
				expect(v.gain).toBeGreaterThan(0);
				expect(v.gain).toBeLessThanOrEqual(MAX_VOICE_GAIN);
				// The decay gets time of its own after the rise and the hold.
				expect(v.dur).toBeGreaterThan((v.attack ?? 0.005) + (v.hold ?? 0) + 0.02);
				if (v.wave === 'noise') {
					expect(v.filter, 'noise is always filtered: raw hiss is harsh').toBeDefined();
				} else {
					for (const f of [v.freq, v.to ?? v.freq]) {
						expect(f).toBeGreaterThanOrEqual(40);
						expect(f).toBeLessThanOrEqual(4000);
					}
				}
			}
		});
	}

	it('pitches medium a third and hard a fifth above easy', () => {
		expect(levelPitch(1)).toBe(1);
		expect(levelPitch(2)).toBeCloseTo(1.26, 2);
		expect(levelPitch(3)).toBeCloseTo(1.498, 2);
	});
});

describe('scheduleCue', () => {
	for (const name of CUE_NAMES) {
		it(`${name}: starts and ends in silence, inside its length, into the output`, () => {
			const ctx = new FakeContext();
			const out = new FakeGain(ctx);
			const start = 5;
			const end = scheduleCue(asContext(ctx), out as unknown as AudioNode, CUES[name], start);
			expect(end).toBeCloseTo(start + cueSeconds(CUES[name]), 6);

			const sources = ctx.sources().filter((s) => s.started !== null);
			expect(sources.length).toBeGreaterThanOrEqual(CUES[name].voices.length);
			for (const source of sources) {
				expect(source.started!).toBeGreaterThanOrEqual(start);
				expect(source.stopped!).toBeLessThanOrEqual(start + MAX_CUE_SECONDS + 1e-9);
				expect(source.stopped!).toBeGreaterThan(source.started!);
			}
			// Every voice is heard through the output, and only through it.
			const voices = sources.filter((s) => !isLfo(s));
			expect(voices).toHaveLength(CUES[name].voices.length);
			for (const source of voices) expect(reaches(source, out)).toBe(true);
			for (const node of ctx.nodes) expect(node.outputs).not.toContain(ctx.destination);

			// Each envelope rises from 0, stays gentle and ends at 0 before the voice stops.
			const envelopes = ctx.nodes.filter(
				(n): n is FakeGain => n instanceof FakeGain && n !== out && n.outputs.includes(out)
			);
			expect(envelopes).toHaveLength(CUES[name].voices.length);
			for (const env of envelopes) {
				const events = env.gain.events;
				expect(events[0]).toMatchObject({ method: 'set', value: 0 });
				expect(Math.max(...events.map((e) => e.value))).toBeLessThanOrEqual(MAX_VOICE_GAIN);
				expect(events.at(-1)!.value).toBe(0);
			}
		});
	}

	it('plays a pitched cue that many times higher', () => {
		const ctx = new FakeContext();
		const out = new FakeGain(ctx);
		scheduleCue(asContext(ctx), out as unknown as AudioNode, CUES.move, 0, 2);
		const osc = ctx.nodes.find((n): n is FakeOscillator => n instanceof FakeOscillator)!;
		expect(osc.frequency.events[0]!.value).toBeCloseTo(CUES.move.voices[0]!.freq * 2, 6);
	});

	it('lets go of a voice’s nodes when it ends', () => {
		const ctx = new FakeContext();
		const out = new FakeGain(ctx);
		scheduleCue(asContext(ctx), out as unknown as AudioNode, CUES.boing, 0);
		for (const source of ctx.sources()) source.onended?.();
		for (const node of ctx.nodes) if (node !== out) expect(node.outputs).toEqual([]);
	});
});

/** A vibrato's oscillator feeds another oscillator's pitch, not the sound itself. */
function isLfo(source: FakeSource): boolean {
	return (
		source.outputs.length > 0 &&
		source.outputs.every(
			(o) => o instanceof FakeNode && o.outputs.every((p) => p instanceof FakeParam)
		)
	);
}

describe('Sfx', () => {
	function setup(stored: Record<string, string> = {}) {
		const contexts: FakeContext[] = [];
		const storage = memoryStorage(stored);
		/** Whether the browser counts the current key as the player's press. */
		const activation = { active: true };
		const sfx = new Sfx({
			createContext: () => {
				const ctx = new FakeContext();
				contexts.push(ctx);
				return asContext(ctx);
			},
			storage: () => storage,
			mayStart: () => activation.active
		});
		const heard: CueName[] = [];
		sfx.onCue((cue) => heard.push(cue));
		const started = () => contexts.flatMap((c) => c.sources()).filter((s) => s.started !== null);
		return { sfx, contexts, storage, heard, started, activation };
	}

	it('makes no sound, and no context, before the first key press', () => {
		const t = setup();
		t.sfx.play('encounter');
		expect(t.contexts).toHaveLength(0);
		expect(t.heard).toEqual(['encounter']);
		expect(t.sfx.recent).toEqual(['encounter']);
	});

	it('waits for a key the browser counts: Escape or Shift first makes no context', () => {
		const t = setup();
		t.activation.active = false;
		t.sfx.unlock();
		expect(t.contexts).toHaveLength(0);
		t.activation.active = true;
		t.sfx.unlock();
		expect(t.contexts).toHaveLength(1);
		// A context the browser suspended later is only woken by a press that counts.
		const ctx = t.contexts[0]!;
		ctx.state = 'suspended';
		t.activation.active = false;
		t.sfx.unlock();
		expect(ctx.resumes).toBe(1);
		t.activation.active = true;
		t.sfx.unlock();
		expect(ctx.resumes).toBe(2);
	});

	it('wakes on a key press and plays through a modest master volume', () => {
		const t = setup();
		t.sfx.unlock();
		t.sfx.unlock();
		expect(t.contexts).toHaveLength(1);
		const ctx = t.contexts[0]!;
		expect(ctx.state).toBe('running');
		const master = ctx.nodes.find(
			(n): n is FakeGain =>
				n instanceof FakeGain && n.outputs.some((o) => o instanceof FakeCompressor)
		)!;
		expect(master.gain.value).toBe(MASTER_VOLUME);
		expect(MASTER_VOLUME).toBeLessThanOrEqual(0.4);
		expect(reaches(master, ctx.destination)).toBe(true);

		ctx.currentTime = 12;
		t.sfx.play('correct', { delay: 0.5 });
		const sources = t.started();
		expect(sources.length).toBeGreaterThan(0);
		for (const s of sources) {
			expect(s.started!).toBeGreaterThanOrEqual(12.5);
			expect(reaches(s, master)).toBe(true);
		}
	});

	it('is on by default and remembers being turned off and on', () => {
		const t = setup();
		expect(t.sfx.on).toBe(true);
		t.sfx.unlock();
		t.sfx.set(false);
		expect(t.storage.data.get(SOUND_STORAGE_KEY)).toBe('off');
		expect(t.contexts[0]!.state).toBe('suspended');
		t.sfx.play('hit');
		expect(t.started()).toEqual([]);
		expect(t.heard).toEqual(['hit']); // still asked for: ?debug shows it

		t.sfx.set(true);
		expect(t.storage.data.get(SOUND_STORAGE_KEY)).toBe('on');
		expect(t.contexts[0]!.state).toBe('running');
		t.sfx.play('hit');
		expect(t.started().length).toBeGreaterThan(0);
		expect(t.contexts).toHaveLength(1);
	});

	it('cuts a cue that is playing when turned off, and it never comes back', () => {
		const t = setup();
		t.sfx.unlock();
		t.sfx.play('won');
		const playing = t.started();
		t.sfx.set(false);
		t.sfx.set(true);
		const ctx = t.contexts[0]!;
		const liveMaster = ctx.nodes.filter(
			(n) => n instanceof FakeGain && n.outputs.some((o) => o instanceof FakeCompressor)
		);
		expect(liveMaster).toHaveLength(1);
		for (const s of playing) expect(reaches(s, ctx.destination)).toBe(false);
	});

	it('starts muted when this device said so, and makes no context until turned on', () => {
		const t = setup({ [SOUND_STORAGE_KEY]: 'off' });
		expect(t.sfx.on).toBe(false);
		t.sfx.unlock();
		t.sfx.play('lead');
		expect(t.contexts).toHaveLength(0);
		t.sfx.set(true);
		expect(t.contexts).toHaveLength(1);
	});

	it('M flips the setting and counts each flip for the chip', () => {
		const t = setup();
		t.sfx.flip();
		expect(t.sfx.on).toBe(false);
		t.sfx.flip();
		expect(t.sfx.on).toBe(true);
		expect(t.sfx.flips).toBe(2);
	});

	it('keeps the last four cues for ?debug', () => {
		const t = setup();
		for (const cue of ['move', 'move', 'confirm', 'encounter', 'correct'] as const) t.sfx.play(cue);
		expect(t.sfx.recent).toEqual(['move', 'confirm', 'encounter', 'correct']);
	});

	it('plays on in silence without WebAudio or storage', () => {
		let asked = 0;
		const sfx = new Sfx({
			createContext: () => {
				asked++;
				return null;
			},
			storage: () => {
				throw new Error('SecurityError: storage is blocked');
			}
		});
		expect(sfx.on).toBe(true);
		expect(() => {
			sfx.unlock();
			sfx.play('caught');
			sfx.set(false);
			sfx.set(true);
			sfx.unlock();
			sfx.flip();
		}).not.toThrow();
		expect(asked).toBe(1); // no WebAudio: it stops asking
	});

	it('drops a cue that fails to schedule instead of throwing', () => {
		const ctx = new FakeContext();
		ctx.createOscillator = () => {
			throw new Error('no oscillators today');
		};
		const sfx = new Sfx({ createContext: () => asContext(ctx), storage: () => null });
		sfx.unlock();
		expect(() => sfx.play('confirm')).not.toThrow();
	});
});
