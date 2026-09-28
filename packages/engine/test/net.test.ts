import { describe, expect, it } from 'vitest';
import { ANIMALS, canFightIn, getAnimal } from '../src/animals/catalog.js';
import { applyMatchIntent, startMatch } from '../src/match/reducer.js';
import { MATCH_TEAM_SIZE, matchTeam } from '../src/match/team.js';
import type { MatchIntent, MatchSide } from '../src/match/types.js';
import { matchView } from '../src/match/view.js';
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
	MAX_SERVER_MESSAGE_BYTES,
	MAX_WIRE_COORD,
	MAX_WIRE_NAME,
	PROTOCOL_VERSION,
	REFRESH_CLOSE_CODE,
	INVITE_ENDS,
	MATCH_TIMEOUTS,
	byeCloseCode,
	byeReasonOf,
	helloVersion,
	parseClientMessage,
	parseServerMessage,
	readWire,
	type ClientMessage,
	type MatchMessage,
	type PlayIntent,
	type RosterEntry,
	type ServerMessage,
	type WireAnimal,
	type WireMatchEvent
} from '../src/net/protocol.js';
import {
	FIGHT_ENDS,
	MAX_FIGHT_EVENTS,
	type FightAnimal,
	type FightEvent,
	type FightView
} from '../src/net/fight.js';
import type { PuzzleFace } from '../src/puzzles/face.js';
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
const LAND = ANIMALS.filter((a) => canFightIn(a.id, 'land')).map((a) => a.id);
const NICKNAMES = [undefined, 'Nini', 'Pip', 'Mr. Wu', "O'Hara", 'Bjørn-Åge', 'WWWWWWWWWWWW'];

/** A team a page may send: one to three animals, ids as long as a save keeps, maybe nicknamed. */
function randomTeam(rng: Rng): WireAnimal[] {
	return Array.from({ length: rng.int(1, MATCH_TEAM_SIZE) }, (_, i) => {
		const nickname = pick(rng, NICKNAMES);
		const id = `${pick(rng, ['starter', 'id', 'x'.repeat(62)])}-${i}`;
		const speciesId = pick(rng, LAND);
		return nickname === undefined ? { id, speciesId } : { id, speciesId, nickname };
	});
}

function randomPlay(rng: Rng): PlayIntent {
	switch (rng.int(0, 4)) {
		case 0:
			return { type: 'attack', attackIndex: rng.int(1, 4), level: pick(rng, [1, 2, 3] as const) };
		case 1:
			return { type: 'answer', input: pick(rng, ['', '7', '-12', '0042', 'abc', '1234567']) };
		case 2:
			return { type: 'switch', teamIndex: rng.int(0, 2) };
		case 3:
			return { type: 'pick-next', teamIndex: rng.int(0, 2) };
		default:
			return { type: 'leave' };
	}
}

const FACES: readonly PuzzleFace[] = [
	{ kind: 'mul', numbers: [7, 8] },
	{ kind: 'missing', numbers: [4, 20], times: true },
	{ kind: 'missing', numbers: [7, 12] },
	{ kind: 'sequence', numbers: [0, 1, 2, 3] },
	{ kind: 'sqrt', numbers: [99_999] }
];

/** Someone's animal in a fight: any species, HP within its own (never a nickname: no words cross). */
function randomFighter(rng: Rng): FightAnimal {
	const species = pick(rng, ANIMALS).id;
	return { species, hp: rng.int(0, getAnimal(species).maxHp) };
}

function randomFightView(rng: Rng): FightView {
	return {
		realm: pick(rng, ['land', 'water'] as const),
		a: randomFighter(rng),
		b: randomFighter(rng),
		turn: pick(rng, ['a', 'b', null] as const),
		puzzle: rng.chance(0.3) ? null : pick(rng, FACES)
	};
}

function randomFightEvents(rng: Rng): FightEvent[] {
	const side = () => pick(rng, ['a', 'b'] as const);
	return Array.from({ length: rng.int(0, MAX_FIGHT_EVENTS) }, (): FightEvent => {
		switch (rng.int(0, 7)) {
			case 0:
				return { type: 'puzzle', side: side(), puzzle: pick(rng, FACES) };
			case 1:
				return { type: 'judged', side: side(), correct: rng.chance(0.5) };
			case 2:
				return {
					type: 'hit',
					attacker: side(),
					level: pick(rng, [1, 2, 3] as const),
					damage: rng.int(0, 40),
					hp: rng.int(0, 40)
				};
			case 3:
				return { type: 'missed', attacker: side() };
			case 4:
				return { type: 'leash', caught: rng.chance(0.5) };
			case 5:
				return { type: 'switched', side: side(), animal: randomFighter(rng) };
			case 6:
				return { type: 'fainted', side: side() };
			default:
				return {
					type: 'ended',
					winner: pick(rng, ['a', 'b', null] as const),
					how: pick(rng, FIGHT_ENDS)
				};
		}
	});
}

function randomClient(rng: Rng): ClientMessage {
	switch (rng.int(0, 11)) {
		case 10:
			return { t: 'battle', view: randomFightView(rng), events: randomFightEvents(rng) };
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
		case 2:
			return { t: 'find', pid: token(rng, 6, 32) };
		case 3:
			return { t: 'challenge', pid: token(rng, 6, 32), team: randomTeam(rng) };
		case 4:
			return { t: 'withdraw' };
		case 5:
			return { t: 'accept', pid: token(rng, 6, 32), team: randomTeam(rng) };
		case 6:
			return { t: 'decline', pid: token(rng, 6, 32) };
		case 7:
			return { t: 'play', id: token(rng, 6, 32), intent: randomPlay(rng) };
		case 8:
			return { t: 'here', id: token(rng, 6, 32) };
		case 9:
			return { t: 'rematch', id: token(rng, 6, 32), team: randomTeam(rng) };
		default:
			return { t: 'done', id: token(rng, 6, 32) };
	}
}

/**
 * A match message as the server sends one: a real match between two random
 * teams, played for a few random intents (right and wrong answers, switches,
 * picks, leaving), seen from one side, with the events of its last step.
 */
function randomMatchMessage(rng: Rng): MatchMessage {
	const party = () =>
		Array.from({ length: rng.int(1, 4) }, (_, i) => {
			const speciesId = pick(rng, LAND);
			const nickname = pick(rng, NICKNAMES);
			// Unique within the party: a save never repeats an id.
			const id = `${pick(rng, ['starter', 'id', 'x'.repeat(62)])}-${i}`;
			return nickname === undefined ? { id, speciesId, hp: 1 } : { id, speciesId, nickname, hp: 1 };
		});
	const seed = rng.int(0, 2 ** 31);
	let state = startMatch({ a: party(), b: party() }, seed);
	let events: WireMatchEvent[] = [];
	const steps = rng.int(0, 12);
	for (let i = 0; i < steps && state.phase.kind !== 'ended'; i++) {
		const phase = state.phase;
		const side: MatchSide = phase.side;
		let intent: MatchIntent;
		if (phase.kind === 'solving') {
			const right = String(phase.puzzle.answer);
			intent = { type: 'answer', input: rng.chance(0.7) ? right : right + '1' };
		} else if (phase.kind === 'choose-animal' || rng.chance(0.2)) {
			intent = {
				type: phase.kind === 'choose-animal' ? 'pick-next' : 'switch',
				teamIndex: rng.int(0, 2)
			};
		} else if (rng.chance(0.03)) {
			intent = { type: pick(rng, ['leave', 'timeout'] as const) };
		} else {
			const attacks = getAnimal(state.teams[side][state.active[side]]!.speciesId).attacks.length;
			intent = {
				type: 'attack',
				attackIndex: rng.int(1, attacks),
				level: pick(rng, [1, 2, 3] as const)
			};
		}
		const step = applyMatchIntent(state, side, intent, seed);
		state = step.state;
		events = step.events.filter((e): e is WireMatchEvent => e.type !== 'rejected');
	}
	const side = pick(rng, ['a', 'b'] as const);
	return {
		t: 'match',
		id: token(rng, 6, 32),
		pids: { a: token(rng, 6, 32), b: token(rng, 6, 32) },
		names: { a: pick(rng, names), b: pick(rng, names) },
		view: matchView(state, side),
		events,
		away: rng.chance(0.3) ? { side: pick(rng, ['a', 'b'] as const), ms: rng.int(0, 30_000) } : null,
		timeout: rng.chance(0.3) ? pick(rng, MATCH_TIMEOUTS) : null
	};
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
	switch (rng.int(0, 15)) {
		case 15:
			return {
				t: 'fight',
				pid,
				vs: rng.chance(0.5) ? null : `${pid}x`.slice(-32),
				view: randomFightView(rng),
				events: randomFightEvents(rng)
			};
		case 0:
			return {
				t: 'hi',
				v: PROTOCOL_VERSION,
				pid,
				name: pick(rng, names),
				match: rng.chance(0.5) ? token(rng, 6, 32) : null
			};
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
		case 7:
			return { t: 'bye', reason: pick(rng, BYE_REASONS) };
		case 8:
			return { t: 'invite', pid, name: pick(rng, names), ms: rng.int(0, 20_000) };
		case 9:
			return { t: 'asking', pid, ms: rng.int(0, 20_000) };
		case 10:
			return { t: 'uninvite', pid, reason: pick(rng, INVITE_ENDS) };
		case 11:
			return randomMatchMessage(rng);
		case 12:
			return { t: 'rejected', id: token(rng, 6, 32), reason: 'not-your-turn' };
		case 13:
			return { t: 'nudge', id: token(rng, 6, 32) };
		default:
			return {
				t: 'rematch-wish',
				id: token(rng, 6, 32),
				side: pick(rng, ['a', 'b'] as const),
				yes: rng.chance(0.5)
			};
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
		// About 0.35 s alone (2,000 messages each way, through JSON and read back); 2.6 s at a
		// load average of 33.
	}, 30_000);

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
						// Nobody else in the world is an empty roster, and a match message
						// with no events (a start, a resume) is one too, which is fine.
						const empty = Array.isArray(junk) && junk.length === 0;
						if ((key === 'players' || key === 'events') && empty) continue;
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

	it('bumps the version with every new species: a page drops a match or a fight with one it does not know', () => {
		// A page of the last version would never see a match with the new animal in it, nor
		// a fight; told to refresh, it reloads with the new catalog (#89's second wave: 5,
		// its third, the sea's: 6).
		expect(
			{ version: PROTOCOL_VERSION, species: ANIMALS.length },
			'a new species bumps PROTOCOL_VERSION'
		).toEqual({ version: 6, species: 49 });
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

	it('keeps coordinates where the game draws a tile true: its matrices are 32-bit floats', () => {
		// A ground tile's place is a float32 in its instance matrix: at 2^30 two neighbours
		// would be drawn 128 tiles apart, and a friend's page could send a kid there.
		for (const edge of [MAX_WIRE_COORD, -MAX_WIRE_COORD]) {
			for (const within of [0.5, 0.37, 0.01]) {
				expect(Math.abs(Math.fround(edge + within) - (edge + within))).toBeLessThan(0.01);
			}
		}
	});

	it('reads only JSON text short enough for the wire', () => {
		expect(readWire('{"t":"find","pid":"abcdef"}')).toEqual({ t: 'find', pid: 'abcdef' });
		expect(readWire('{"t":')).toBeUndefined();
		expect(readWire('')).toBeUndefined();
		expect(
			readWire(JSON.stringify({ t: 'x', pad: 'y'.repeat(MAX_MESSAGE_BYTES) }))
		).toBeUndefined();
		// A browser reads more from the server than it may send, and no more than that.
		const long = { t: 'x', pad: 'y'.repeat(MAX_MESSAGE_BYTES) };
		expect(readWire(JSON.stringify(long), MAX_SERVER_MESSAGE_BYTES)).toEqual(long);
		const tooLong = { t: 'x', pad: 'y'.repeat(MAX_SERVER_MESSAGE_BYTES) };
		expect(readWire(JSON.stringify(tooLong), MAX_SERVER_MESSAGE_BYTES)).toBeUndefined();
	});
});

/** Every path to a value in `value`, objects and arrays walked into. */
function leafPaths(value: unknown, path: (string | number)[] = []): (string | number)[][] {
	if (Array.isArray(value)) return value.flatMap((v, i) => leafPaths(v, [...path, i]));
	if (value !== null && typeof value === 'object') {
		return Object.entries(value).flatMap(([k, v]) => [
			...(v !== null && typeof v === 'object' ? [[...path, k]] : []),
			...leafPaths(v, [...path, k])
		]);
	}
	return [path];
}

function withAt(value: unknown, path: (string | number)[], replacement: unknown): unknown {
	const copy = structuredClone(value) as Record<string | number, unknown>;
	let at = copy;
	for (const step of path.slice(0, -1)) at = at[step] as Record<string | number, unknown>;
	const last = path[path.length - 1]!;
	if (replacement === DELETE) delete at[last];
	else at[last] = replacement;
	return copy;
}
const DELETE = Symbol('delete');

describe('friendly matches on the wire', () => {
	it('reads back every match message a real match makes, and each fits what a page reads', () => {
		const rng = new Rng(11);
		let biggest = 0;
		for (let i = 0; i < 400; i++) {
			const message = randomMatchMessage(rng);
			const text = JSON.stringify(message);
			expect(parseServerMessage(readWire(text, MAX_SERVER_MESSAGE_BYTES))).toEqual(message);
			biggest = Math.max(biggest, new TextEncoder().encode(text).length);
		}
		// Names and nicknames as long as the wire takes, four bytes a character:
		// still far inside what a page reads.
		const long = randomMatchMessage(new Rng(12));
		long.names = { a: '𝓐'.repeat(MAX_WIRE_NAME / 2), b: '𝓑'.repeat(MAX_WIRE_NAME / 2) };
		for (const side of ['a', 'b'] as const) {
			long.view.teams[side].forEach((animal, i) => {
				(animal as { nickname?: string }).nickname = '𝓦'.repeat(32);
				(animal as { id: string }).id = `${side}:${'x'.repeat(63)}${i}`;
			});
		}
		const bytes = new TextEncoder().encode(JSON.stringify(long)).length;
		expect(parseServerMessage(long)).toEqual(long);
		expect(Math.max(biggest, bytes)).toBeLessThan(MAX_SERVER_MESSAGE_BYTES / 2);
	});

	it('refuses a match message with anything inside it swapped for junk, or missing', () => {
		const rng = new Rng(13);
		const through: string[] = [];
		for (let i = 0; i < 20; i++) {
			// One copy, changed in place and put back after each try: no copy per try.
			const message = JSON.parse(JSON.stringify(randomMatchMessage(rng))) as Record<
				string,
				unknown
			>;
			for (const path of leafPaths(message)) {
				const where = path.join('.');
				let parent = message as Record<string | number, unknown>;
				for (const step of path.slice(0, -1))
					parent = parent[step] as Record<string | number, unknown>;
				const key = path[path.length - 1]!;
				const original = parent[key];
				// A nickname is the one field that may be missing; an empty list of events
				// is a whole message too (a start, a resume).
				const optional = key === 'nickname';
				for (const junk of [...JUNK, DELETE]) {
					if ((junk === undefined || junk === DELETE) && optional) continue;
					if (where === 'events' && Array.isArray(junk) && junk.length === 0) continue;
					if (junk === DELETE) delete parent[key];
					else parent[key] = junk;
					if (parseServerMessage(message) !== null) through.push(`${where} = ${String(junk)}`);
				}
				parent[key] = original;
			}
		}
		expect(through.slice(0, 20)).toEqual([]);
	});

	it('refuses a view whose animal in front is not on its team, HP past its most, or a puzzle kind it does not know', () => {
		const message = randomMatchMessage(new Rng(14));
		const team = message.view.teams.a;
		const species = team[0]!.speciesId;
		const bad = [
			withAt(message, ['view', 'active', 'a'], team.length),
			withAt(message, ['view', 'teams', 'a', 0, 'hp'], getAnimal(species).maxHp + 1),
			withAt(message, ['view', 'teams', 'a', 0, 'speciesId'], 'dragon'),
			withAt(message, ['view', 'teams', 'b'], []),
			withAt(message, ['view', 'phase'], {
				kind: 'solving',
				side: 'a',
				attackIndex: 1,
				level: 1,
				puzzle: { kind: 'calculus', difficulty: 1, prompt: '1 + 1 = ?' }
			}),
			withAt(message, ['view', 'phase'], { kind: 'ended', winner: 'a', reason: 'draw' }),
			withAt(
				message,
				['events'],
				Array.from({ length: 17 }, () => ({ type: 'ended', winner: 'a', reason: 'left' }))
			)
		];
		for (const value of bad) expect(parseServerMessage(value)).toBeNull();
		// An event of a kind the match never sends on (a refusal goes on its own) is refused.
		expect(
			parseServerMessage(withAt(message, ['events'], [{ type: 'rejected', reason: 'tired' }]))
		).toBeNull();
	});

	it('takes a team through the wire and back as the same team, and never a timeout from a page', () => {
		const rng = new Rng(15);
		for (let i = 0; i < 200; i++) {
			const party = Array.from({ length: rng.int(1, 6) }, (_, n) => ({
				id: `id-${n}`,
				speciesId: pick(rng, ANIMALS).id,
				hp: 0,
				...(rng.chance(0.5) ? { nickname: pick(rng, ['Nini', ' Pip ', 'Bjørn']) } : {})
			}));
			const pick1 = matchTeam(party);
			if (!pick1.ok) continue;
			const team: WireAnimal[] = pick1.team.map(({ id, speciesId, nickname }) =>
				nickname === undefined ? { id, speciesId } : { id, speciesId, nickname }
			);
			const sent = parseClientMessage(
				readWire(JSON.stringify({ t: 'challenge', pid: 'abcdef', team }))
			);
			expect(sent?.t === 'challenge' && matchTeam(sent.team)).toEqual(pick1);
		}
		expect(parseClientMessage({ t: 'play', id: 'abcdef', intent: { type: 'timeout' } })).toBeNull();
		// A team of more than three, or none, is no team a page sends.
		const four = Array.from({ length: 4 }, (_, n) => ({ id: `id-${n}`, speciesId: 'fox' }));
		expect(parseClientMessage({ t: 'challenge', pid: 'abcdef', team: four })).toBeNull();
		expect(parseClientMessage({ t: 'accept', pid: 'abcdef', team: [] })).toBeNull();
	});
});

describe('battles seen from outside on the wire', () => {
	it('refuses a battle or a fight with anything inside it swapped for junk, or missing', () => {
		const rng = new Rng(21);
		const through: string[] = [];
		for (let i = 0; i < 12; i++) {
			const pid = token(rng, 6, 32);
			const view = randomFightView(rng);
			const events = randomFightEvents(rng);
			for (const [message, parse] of [
				[{ t: 'battle', view, events }, parseClientMessage],
				[{ t: 'fight', pid, vs: null, view, events }, parseServerMessage]
			] as const) {
				// One copy, changed in place and put back after each try: no copy per try.
				const copy = JSON.parse(JSON.stringify(message)) as Record<string, unknown>;
				for (const path of leafPaths(copy)) {
					const where = path.join('.');
					let parent = copy as Record<string | number, unknown>;
					for (const step of path.slice(0, -1))
						parent = parent[step] as Record<string | number, unknown>;
					const key = path[path.length - 1]!;
					const original = parent[key];
					// A times table's sign is the field that may be missing; no events is a whole
					// message too (a battle just begun, a player just come near).
					const optional = key === 'times';
					for (const junk of [...JUNK, DELETE]) {
						if ((junk === undefined || junk === DELETE) && optional) continue;
						if (where === 'events' && Array.isArray(junk) && junk.length === 0) continue;
						// Two small numbers are a sum's two numbers: not junk there.
						if (key === 'numbers' && Array.isArray(junk) && junk.length === 2) continue;
						if (junk === DELETE) delete parent[key];
						else parent[key] = junk;
						if (parse(copy) !== null) through.push(`${where} = ${String(junk)}`);
					}
					parent[key] = original;
				}
			}
		}
		expect(through.slice(0, 20)).toEqual([]);
		// About 30,000 parses of a whole message, each nickname through the name rules: 1.9 s at a
		// load average of 66.
	}, 30_000);

	it('takes a fight between two players, never one with itself, and sends every battle a page makes within what it may send', () => {
		const view = randomFightView(new Rng(22));
		const fight = { t: 'fight', pid: 'abcdef', vs: 'ghijkl', view, events: [] };
		expect(parseServerMessage(fight)).toEqual(fight);
		expect(parseServerMessage({ ...fight, vs: 'abcdef' })).toBeNull();
		expect(parseClientMessage({ ...fight, t: 'battle' })).toEqual({
			t: 'battle',
			view,
			events: []
		});
		// A page's battle never reaches another page as it sent it, nor the server's fight a server.
		expect(parseServerMessage({ t: 'battle', view, events: [] })).toBeNull();
		expect(parseClientMessage(fight)).toBeNull();
		// The longest species id the catalog has, on every animal of the most events one message carries.
		const longest = ANIMALS.map((a) => a.id).sort((x, y) => y.length - x.length)[0]!;
		const long: FightAnimal = { species: longest, hp: 1 };
		const events: FightEvent[] = Array.from({ length: MAX_FIGHT_EVENTS }, () => ({
			type: 'switched',
			side: 'a',
			animal: long
		}));
		const bytes = new TextEncoder().encode(
			JSON.stringify({
				t: 'fight',
				pid: 'x'.repeat(32),
				vs: 'y'.repeat(32),
				view: { ...view, a: long, b: long },
				events
			})
		).length;
		// Small: a report fans out to every player near its page, so each one costs them little.
		expect(bytes).toBeLessThan(1200);
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
