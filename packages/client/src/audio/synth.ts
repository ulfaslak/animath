import { DEFAULT_ATTACK, TAIL_SECONDS, type Cue, type Voice } from './cues';

/**
 * Turns a cue (`cues.ts`) into WebAudio nodes on any context — the page's
 * `AudioContext`, or an `OfflineAudioContext` that renders it to numbers.
 * Every voice is a source (an oscillator, or looped noise) through an
 * optional filter and a gain envelope into `out`; the nodes stop and let go
 * of each other when the voice ends. Nothing here knows about the setting,
 * the unlock or the game: `sfx.svelte.ts` does.
 */

/** Level the envelope decays to: silent to the ear, and above zero as an exponential ramp needs. */
const FLOOR = 0.0001;

/**
 * Schedule `cue` to start at `start` (context seconds), `pitch` times higher
 * than written. Returns when its last voice stops.
 */
export function scheduleCue(
	ctx: BaseAudioContext,
	out: AudioNode,
	cue: Cue,
	start: number,
	pitch = 1
): number {
	let end = start;
	for (const voice of cue.voices) {
		end = Math.max(end, scheduleVoice(ctx, out, voice, start + voice.at, pitch));
	}
	return end;
}

function scheduleVoice(
	ctx: BaseAudioContext,
	out: AudioNode,
	v: Voice,
	t0: number,
	pitch: number
): number {
	const attack = v.attack ?? DEFAULT_ATTACK;
	const t1 = t0 + v.dur;
	const stop = t1 + TAIL_SECONDS;

	// The envelope: silence, a rise to the peak, an optional hold, a decay to silence.
	const env = ctx.createGain();
	env.gain.setValueAtTime(0, t0);
	env.gain.linearRampToValueAtTime(v.gain, t0 + attack);
	if (v.hold) env.gain.setValueAtTime(v.gain, t0 + attack + v.hold);
	env.gain.exponentialRampToValueAtTime(FLOOR, t1);
	env.gain.setValueAtTime(0, t1);

	const nodes: AudioNode[] = [env];
	let source: AudioScheduledSourceNode;
	let lfo: OscillatorNode | null = null;
	if (v.wave === 'noise') {
		const noise = ctx.createBufferSource();
		noise.buffer = noiseBuffer(ctx);
		noise.loop = true;
		source = noise;
	} else {
		const osc = ctx.createOscillator();
		osc.type = v.wave;
		osc.frequency.setValueAtTime(v.freq * pitch, t0);
		if (v.to) osc.frequency.exponentialRampToValueAtTime(v.to * pitch, t1);
		if (v.vibrato) {
			// A slow oscillator nudging the pitch up and down, its reach fading to nothing.
			lfo = ctx.createOscillator();
			lfo.frequency.setValueAtTime(v.vibrato.rate, t0);
			const reach = ctx.createGain();
			reach.gain.setValueAtTime(v.vibrato.depth * v.freq * pitch, t0);
			reach.gain.linearRampToValueAtTime(0, t1);
			lfo.connect(reach);
			reach.connect(osc.frequency);
			nodes.push(lfo, reach);
		}
		source = osc;
	}
	nodes.push(source);

	let head: AudioNode = source;
	if (v.filter) {
		const filter = ctx.createBiquadFilter();
		filter.type = v.filter.type;
		filter.frequency.setValueAtTime(v.filter.freq * pitch, t0);
		if (v.filter.to) filter.frequency.exponentialRampToValueAtTime(v.filter.to * pitch, t1);
		if (v.filter.q !== undefined) filter.Q.setValueAtTime(v.filter.q, t0);
		source.connect(filter);
		head = filter;
		nodes.push(filter);
	}
	head.connect(env);
	env.connect(out);

	source.start(t0);
	source.stop(stop);
	if (lfo) {
		lfo.start(t0);
		lfo.stop(stop);
	}
	source.onended = () => {
		for (const node of nodes) node.disconnect();
	};
	return stop;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/**
 * One second of white noise per context, made once. Seeded, so a cue renders
 * the same every time (an offline render can be compared between runs).
 */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
	let buffer = noiseBuffers.get(ctx);
	if (!buffer) {
		buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		let seed = 0x2f6b7a1d;
		for (let i = 0; i < data.length; i++) {
			// xorshift32: fast, and plenty random for a hiss.
			seed ^= seed << 13;
			seed ^= seed >>> 17;
			seed ^= seed << 5;
			data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
		}
		noiseBuffers.set(ctx, buffer);
	}
	return buffer;
}
