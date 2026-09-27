import { describe, expect, it } from 'vitest';
import { ANIMALS } from '../src/animals/catalog.js';
import {
	VIEW_KEEP,
	VIEW_RADIUS,
	bearingTo,
	bearingVector,
	inView,
	roughSteps,
	tilesApart
} from '../src/net/nearby.js';
import {
	BEARINGS,
	BUSY_STATES,
	BYE_CLOSE_CODE,
	BYE_REASONS,
	MAX_MESSAGE_BYTES,
	MAX_ROSTER,
	MAX_WIRE_COORD,
	MAX_WIRE_NAME,
	PROTOCOL_VERSION,
	REFRESH_CLOSE_CODE,
	byeCloseCode,
	byeReasonOf,
	helloVersion,
	parseClientMessage,
	parseServerMessage,
	readWire,
	type ClientMessage,
	type RosterEntry,
	type ServerMessage
} from '../src/net/protocol.js';
import { Rng } from '../src/rng.js';

const FACINGS = ['up', 'down', 'left', 'right'] as const;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function token(rng: Rng, min: number, max: number): string {
	const n = rng.int(min, max);
	return Array.from({ length: n }, () => BASE64URL[rng.int(0, BASE64URL.length - 1)]).join('');
}
const pick = <T>(rng: Rng, list: readonly T[]): T => list[rng.int(0, list.length - 1)]!;
const coord = (rng: Rng) =>
	pick(rng, [0, -1, 5, -MAX_WIRE_COORD, MAX_WIRE_COORD, rng.int(-9999, 9999)]);
const names = ['Ada', 'Bo', 'Åse Ørum', 'Zoë-Li', 'x'.repeat(MAX_WIRE_NAME), '李小龙', '🦊fox'];

function randomClient(rng: Rng): ClientMessage {
	switch (rng.int(0, 2)) {
		case 0:
			return { t: 'hello', v: PROTOCOL_VERSION, guest: token(rng, 16, 64), name: pick(rng, names) };
		case 1:
			return {
				t: 'where',
				world: pick(rng, [1, 2, 9999, rng.int(1, 9999)]),
				x: coord(rng),
				y: coord(rng),
				facing: pick(rng, FACINGS),
				lead: pick(rng, [null, ...ANIMALS.map((a) => a.id)]),
				boat: rng.chance(0.5),
				busy: pick(rng, BUSY_STATES)
			};
		default:
			return { t: 'find', pid: token(rng, 6, 32) };
	}
}

function randomEntry(rng: Rng): RosterEntry {
	return {
		pid: token(rng, 6, 32),
		name: pick(rng, names),
		bearing: rng.int(0, BEARINGS - 1),
		steps: pick(rng, [0, 7, 120, 2 ** 32]),
		busy: pick(rng, BUSY_STATES)
	};
}

function randomServer(rng: Rng): ServerMessage {
	const pid = token(rng, 6, 32);
	switch (rng.int(0, 7)) {
		case 0:
			return { t: 'hi', v: PROTOCOL_VERSION, pid, name: pick(rng, names) };
		case 1:
			return { t: 'refresh', v: rng.int(0, 99) };
		case 2:
			return {
				t: 'peer',
				pid,
				name: pick(rng, names),
				x: coord(rng),
				y: coord(rng),
				facing: pick(rng, FACINGS),
				lead: pick(rng, [null, 'otter', 'whale']),
				boat: rng.chance(0.5),
				busy: pick(rng, BUSY_STATES)
			};
		case 3:
			return { t: 'gone', pid };
		case 4:
			return {
				t: 'roster',
				world: rng.int(1, 9999),
				players: Array.from({ length: rng.int(0, 6) }, () => randomEntry(rng))
			};
		case 5:
			return { t: 'found', pid, x: coord(rng), y: coord(rng) };
		case 6:
			return { t: 'lost', pid };
		default:
			return { t: 'bye', reason: pick(rng, BYE_REASONS) };
	}
}

/**
 * Values no field of any message takes: every one must be refused wherever
 * it goes. (Any short text is a name, and a species this build does not know
 * is read as nobody following, so neither is junk.)
 */
const JUNK: readonly unknown[] = [
	undefined,
	Number.NaN,
	Number.POSITIVE_INFINITY,
	-Number.POSITIVE_INFINITY,
	1.5,
	-0.25,
	2 ** 53,
	-(2 ** 53),
	'x'.repeat(10_000),
	{},
	[],
	[1, 2],
	{ x: 1 },
	() => 1
];

describe('the wire protocol', () => {
	it('reads back every message it can send, through JSON, unchanged', () => {
		const rng = new Rng(1);
		for (let i = 0; i < 2000; i++) {
			const c = randomClient(rng);
			expect(parseClientMessage(readWire(JSON.stringify(c)))).toEqual(c);
			const s = randomServer(rng);
			expect(parseServerMessage(JSON.parse(JSON.stringify(s)))).toEqual(s);
			// Every message a client sends fits on the wire.
			expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(
				MAX_MESSAGE_BYTES
			);
		}
	});

	it('refuses a message with any one field swapped for a value it never takes', () => {
		const rng = new Rng(2);
		// Checked without `expect` in the loop, which is hot: the ones let through are listed.
		const through: string[] = [];
		for (let i = 0; i < 200; i++) {
			const c = randomClient(rng) as unknown as Record<string, unknown>;
			const s = randomServer(rng) as unknown as Record<string, unknown>;
			for (const [msg, parse] of [
				[c, parseClientMessage],
				[s, parseServerMessage]
			] as const) {
				for (const key of Object.keys(msg)) {
					for (const junk of JUNK) {
						// Nobody else in the world is an empty roster, which is fine.
						if (key === 'players' && Array.isArray(junk) && junk.length === 0) continue;
						if (parse({ ...msg, [key]: junk }) !== null) {
							through.push(`${String(msg.t)}.${key} = ${String(junk)}`);
						}
					}
					// An empty name, or a field missing altogether, is refused too.
					if (key === 'name' && parse({ ...msg, name: '' }) !== null) through.push('empty name');
					const { [key]: _, ...without } = msg;
					if (parse(without) !== null) through.push(`${String(msg.t)} without ${key}`);
				}
			}
		}
		expect(through).toEqual([]);
	});

	it('refuses what is not a message at all', () => {
		for (const value of [
			null,
			undefined,
			0,
			'hello',
			[],
			[{ t: 'hello' }],
			{ t: 'nope' },
			{ t: 1 }
		]) {
			expect(parseClientMessage(value)).toBeNull();
			expect(parseServerMessage(value)).toBeNull();
		}
		// Kinds from the other end are not taken: a browser cannot send `peer`, nor the server `where`.
		const rng = new Rng(3);
		for (let i = 0; i < 100; i++) {
			const s = randomServer(rng);
			if (!['hello', 'where', 'find'].includes(s.t)) expect(parseClientMessage(s)).toBeNull();
			const c = randomClient(rng);
			expect(parseServerMessage(c)).toBeNull();
		}
	});

	it('passes on only the fields it knows', () => {
		const where = {
			t: 'where',
			world: 1,
			x: 3,
			y: -4,
			facing: 'left',
			lead: 'fox',
			boat: false,
			busy: 'explore',
			secret: 'nope',
			__proto__: { polluted: true }
		};
		const parsed = parseClientMessage(where) as unknown as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual(
			['boat', 'busy', 'facing', 'lead', 't', 'world', 'x', 'y'].sort()
		);
		expect(parsed.polluted).toBeUndefined();
	});

	it('reads a species it does not know as nobody following, and keeps the rest', () => {
		const parsed = parseClientMessage({
			t: 'where',
			world: 7,
			x: 0,
			y: 0,
			facing: 'up',
			lead: 'dragon',
			boat: true,
			busy: 'battle'
		});
		expect(parsed).toEqual({
			t: 'where',
			world: 7,
			x: 0,
			y: 0,
			facing: 'up',
			lead: null,
			boat: true,
			busy: 'battle'
		});
	});

	it('bounds worlds, coordinates, names and rosters', () => {
		const where = (patch: object) =>
			parseClientMessage({
				t: 'where',
				world: 1,
				x: 0,
				y: 0,
				facing: 'up',
				lead: null,
				boat: false,
				busy: 'explore',
				...patch
			});
		expect(where({ world: 0 })).toBeNull();
		expect(where({ world: 10000 })).toBeNull();
		expect(where({ x: MAX_WIRE_COORD + 1 })).toBeNull();
		expect(where({ y: -MAX_WIRE_COORD - 1 })).toBeNull();
		const hello = (name: string) =>
			parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, guest: 'a'.repeat(22), name });
		expect(hello('x'.repeat(MAX_WIRE_NAME))).not.toBeNull();
		expect(hello('x'.repeat(MAX_WIRE_NAME + 1))).toBeNull();
		expect(hello('')).toBeNull();
		expect(
			parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, guest: 'short', name: 'Ada' })
		).toBeNull();
		const rng = new Rng(4);
		const players = Array.from({ length: MAX_ROSTER + 1 }, () => randomEntry(rng));
		expect(parseServerMessage({ t: 'roster', world: 1, players })).toBeNull();
		expect(
			parseServerMessage({ t: 'roster', world: 1, players: players.slice(0, MAX_ROSTER) })
		).not.toBeNull();
		expect(
			parseServerMessage({ t: 'roster', world: 1, players: [{ ...players[0], bearing: BEARINGS }] })
		).toBeNull();
	});

	it("reads a hello's version before anything else in it", () => {
		expect(helloVersion({ t: 'hello', v: 0, whatever: [1] })).toBe(0);
		expect(helloVersion({ t: 'hello', v: PROTOCOL_VERSION + 1 })).toBe(PROTOCOL_VERSION + 1);
		expect(helloVersion({ t: 'hello', v: 1.5 })).toBeNull();
		expect(helloVersion({ t: 'where', v: 1 })).toBeNull();
		// Another version's hello is no hello to this parser.
		expect(
			parseClientMessage({
				t: 'hello',
				v: PROTOCOL_VERSION + 1,
				guest: 'a'.repeat(22),
				name: 'Ada'
			})
		).toBeNull();
	});

	it('reads only JSON text short enough for the wire', () => {
		expect(readWire('{"t":"find","pid":"abcdef"}')).toEqual({ t: 'find', pid: 'abcdef' });
		expect(readWire('{"t":')).toBeUndefined();
		expect(readWire('')).toBeUndefined();
		expect(
			readWire(JSON.stringify({ t: 'x', pad: 'y'.repeat(MAX_MESSAGE_BYTES) }))
		).toBeUndefined();
	});
});

describe('close codes', () => {
	it("give every bye's reason a code of its own, the application's range, and read it back", () => {
		const codes = BYE_REASONS.map(byeCloseCode);
		expect(new Set([...codes, REFRESH_CLOSE_CODE]).size).toBe(BYE_REASONS.length + 1);
		for (const [i, reason] of BYE_REASONS.entries()) {
			// The codes a server may send: 4000 to 4999 (RFC 6455), and a reason's place never moves.
			expect(codes[i]).toBe(BYE_CLOSE_CODE + i);
			expect(codes[i]).toBeGreaterThanOrEqual(4000);
			expect(codes[i]).toBeLessThan(5000);
			expect(byeReasonOf(codes[i])).toBe(reason);
		}
		expect(byeCloseCode('replaced')).toBe(4000);
		expect(byeCloseCode('restart')).toBe(4005);
		for (const other of [
			1000,
			1001,
			1006,
			3999,
			4006,
			4099,
			REFRESH_CLOSE_CODE,
			4000.5,
			-1,
			NaN,
			'4005',
			null,
			undefined,
			{}
		]) {
			expect(byeReasonOf(other)).toBeNull();
		}
	});
});

describe('who is near whom', () => {
	it('counts tiles apart the long way round a square', () => {
		expect(tilesApart({ x: 0, y: 0 }, { x: 3, y: -7 })).toBe(7);
		expect(tilesApart({ x: -2, y: 5 }, { x: -2, y: 5 })).toBe(0);
	});

	it('sees a player coming within the radius, and keeps them a little further', () => {
		const a = { x: 0, y: 0 };
		expect(inView(a, { x: VIEW_RADIUS, y: 3 }, false)).toBe(true);
		expect(inView(a, { x: VIEW_RADIUS + 1, y: 0 }, false)).toBe(false);
		expect(inView(a, { x: VIEW_RADIUS + 1, y: 0 }, true)).toBe(true);
		expect(inView(a, { x: 0, y: -VIEW_KEEP }, true)).toBe(true);
		expect(inView(a, { x: 0, y: -VIEW_KEEP - 1 }, true)).toBe(false);
	});

	it('points the compass rose the way the other player lies', () => {
		const o = { x: 10, y: 10 };
		expect(bearingTo(o, { x: 10, y: 0 })).toBe(0); // up
		expect(bearingTo(o, { x: 20, y: 0 })).toBe(2); // up-right
		expect(bearingTo(o, { x: 30, y: 10 })).toBe(4); // right
		expect(bearingTo(o, { x: 10, y: 50 })).toBe(8); // down
		expect(bearingTo(o, { x: -5, y: 10 })).toBe(12); // left
		expect(bearingTo(o, o)).toBe(0);
		// Every bearing's vector points within half a sector of the true direction.
		const rng = new Rng(5);
		for (let i = 0; i < 2000; i++) {
			const to = { x: rng.int(-500, 500), y: rng.int(-500, 500) };
			if (to.x === o.x && to.y === o.y) continue;
			const b = bearingTo(o, to);
			expect(b).toBeGreaterThanOrEqual(0);
			expect(b).toBeLessThan(BEARINGS);
			const v = bearingVector(b);
			const dx = to.x - o.x;
			const dy = to.y - o.y;
			const cos = (v.x * dx + v.y * dy) / Math.hypot(dx, dy);
			expect(cos).toBeGreaterThanOrEqual(Math.cos(Math.PI / BEARINGS) - 1e-9);
		}
	});

	it('rounds the steps apart the way a kid would read them', () => {
		const at = (x: number, y = 0) => roughSteps({ x: 0, y: 0 }, { x, y });
		expect(at(7)).toBe(7);
		expect(at(12, -8)).toBe(20);
		expect(at(22)).toBe(20);
		expect(at(23)).toBe(25);
		expect(at(117)).toBe(120);
		expect(at(994)).toBe(990);
		expect(at(1049)).toBe(1000);
		expect(at(-1051)).toBe(1100);
		// Never off by more than half its unit, and never more than a twentieth, past 20.
		for (let n = 0; n < 5000; n += 7) {
			const r = at(n);
			expect(Math.abs(r - n)).toBeLessThanOrEqual(n <= 20 ? 0 : Math.max(2.5, n / 20));
		}
	});
});
