import {
	MAX_SERVER_MESSAGE_BYTES,
	getAnimal,
	parseServerMessage,
	readWire,
	spawnPoint,
	tileAtWorld,
	worldSeed,
	type Busy,
	type ByeReason,
	type GridPos,
	type MatchMessage,
	type ServerMessage,
	type WireAnimal
} from '@mathgame/engine';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenceHub, type Peer } from '../src/presence/hub.js';
import { Matches, type MatchClientMessage, type MatchOptions } from '../src/presence/matches.js';

// The friendly matches without a socket: fake peers keep what they are sent,
// and every message must read back as itself through the wire's parser and
// hold no key named `answer` anywhere. Timers are vitest's, so the invite's
// 20 s, the 30 s to come back and the turn clock run in no time.

/** Every path in `value` to a key named `answer`. */
function answerKeys(value: unknown, path = ''): string[] {
	if (Array.isArray(value)) return value.flatMap((v, i) => answerKeys(v, `${path}[${i}]`));
	if (value === null || typeof value !== 'object') return [];
	return Object.entries(value).flatMap(([k, v]) => [
		...(k === 'answer' ? [`${path}.${k}`] : []),
		...answerKeys(v, `${path}.${k}`)
	]);
}

class FakePeer implements Peer {
	readonly got: ServerMessage[] = [];
	closed: ByeReason | null = null;
	send(message: ServerMessage): void {
		const text = JSON.stringify(message);
		expect(parseServerMessage(readWire(text, MAX_SERVER_MESSAGE_BYTES)), text.slice(0, 80)).toEqual(
			message
		);
		expect(answerKeys(message)).toEqual([]);
		this.got.push(message);
	}
	close(reason: ByeReason): void {
		this.closed = reason;
	}
	of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
		return this.got.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
	}
	last<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }> | undefined {
		return this.of(t).at(-1);
	}
	clear(): void {
		this.got.length = 0;
	}
}

const SEED = worldSeed(1);
const SPAWN = spawnPoint(SEED);
const wet = (x: number, y: number) => {
	const kind = tileAtWorld(SEED, x, y).kind;
	return kind === 'water' || kind === 'deepwater';
};
/** A water tile with land beside it, near World 1's spawn: where a player in a boat floats. */
const SHORE = (() => {
	for (let r = 1; r < 60; r++) {
		for (let dx = -r; dx <= r; dx++) {
			for (let dy = -r; dy <= r; dy++) {
				const x = SPAWN.x + dx;
				const y = SPAWN.y + dy;
				if (wet(x, y) && !wet(x + 1, y)) return { water: { x, y }, land: { x: x + 1, y } };
			}
		}
	}
	throw new Error('no shore near spawn');
})();

const TEAM: WireAnimal[] = [{ id: 'starter', speciesId: 'squirrel', nickname: 'Nini' }];

interface Kid {
	peer: FakePeer;
	pid: string;
	name: string;
	/** The hi's match id, when the kid came back into one. */
	hiMatch: string | null;
	at(pos: GridPos, patch?: { busy?: Busy; world?: number }): void;
	send(message: MatchClientMessage): void;
	leave(): void;
}

let hub: PresenceHub;
let matches: Matches;
let ids = 0;

function setup(options: MatchOptions = {}): void {
	hub = new PresenceHub({
		pidFor: (key, attempt) => `pid${attempt}${key.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 32)
	});
	matches = new Matches(hub, { seed: () => 2026, id: () => `match${++ids}`, ...options });
}

function kid(name: string, pos: GridPos = SPAWN, busy: Busy = 'explore', world = 1): Kid {
	const peer = new FakePeer();
	const key = `guest:${name}`;
	const pid = hub.join(peer, key, name);
	const hiMatch = matches.joined(peer, hub.present(peer)!);
	matches.resume(peer);
	const k: Kid = {
		peer,
		pid,
		name,
		hiMatch,
		at(p, patch = {}) {
			hub.where(peer, {
				t: 'where',
				world: patch.world ?? world,
				x: p.x,
				y: p.y,
				facing: 'down',
				lead: 'squirrel',
				boat: false,
				busy: patch.busy ?? busy
			});
			matches.moved(peer);
		},
		send(message) {
			matches.handle(peer, message);
		},
		leave() {
			hub.leave(peer);
			matches.left(peer);
		}
	};
	k.at(pos);
	return k;
}

const beside = (dx: number, dy = 0): GridPos => ({ x: SPAWN.x + dx, y: SPAWN.y + dy });

/** Ada asks Bo, and Bo says yes: the match both are sent. */
function startedMatch(ada: Kid, bo: Kid): MatchMessage {
	ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
	bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
	const message = ada.peer.last('match');
	if (!message) throw new Error(`no match: ${JSON.stringify(ada.peer.got)}`);
	return message;
}

/** The kid whose turn it is, and the other. */
function turnOf(message: MatchMessage, ada: Kid, bo: Kid): [Kid, Kid] {
	const phase = message.view.phase;
	if (phase.kind === 'ended') throw new Error('over');
	return phase.side === 'a' ? [ada, bo] : [bo, ada];
}

/** The answer to the open puzzle, from the server's own state: what no page can see. */
function answerOf(id: string): string {
	const phase = matches.stateOf(id)?.phase;
	if (phase?.kind !== 'solving') throw new Error('no puzzle');
	return String(phase.puzzle.answer);
}

beforeEach(() => {
	vi.useFakeTimers();
	setup();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('the invite', () => {
	it('goes out to a player beside you, and a Yes starts the match for both, each with its own view', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('asking')).toEqual({ t: 'asking', pid: bo.pid, ms: 20_000 });
		expect(bo.peer.last('invite')).toEqual({ t: 'invite', pid: ada.pid, name: 'Ada', ms: 20_000 });
		bo.send({ t: 'accept', pid: ada.pid, team: [{ id: 'starter', speciesId: 'rabbit' }] });
		const a = ada.peer.last('match')!;
		const b = bo.peer.last('match')!;
		expect(a.id).toBe(b.id);
		expect(a.view.you).toBe('a');
		expect(b.view.you).toBe('b');
		expect(a.pids).toEqual({ a: ada.pid, b: bo.pid });
		expect(a.names).toEqual({ a: 'Ada', b: 'Bo' });
		expect(a.view.teams).toEqual(b.view.teams);
		expect(a.view.teams.a).toEqual([
			{ id: 'a:starter', speciesId: 'squirrel', nickname: 'Nini', hp: getAnimal('squirrel').maxHp }
		]);
		expect(a.view.teams.b[0]!.speciesId).toBe('rabbit');
		expect(a.events).toEqual([]);
		expect(matches.size).toBe(1);
	});

	it('is refused, kindly and with why, when the two can not play now', () => {
		const ada = kid('Ada');
		const reasons: Record<string, string | undefined> = {};
		const ask = (label: string, target: Kid, team: WireAnimal[] = TEAM) => {
			// A second between asks: the match messages' bucket is not what is tested here.
			vi.advanceTimersByTime(1_000);
			ada.peer.clear();
			ada.send({ t: 'challenge', pid: target.pid, team });
			expect(ada.peer.of('asking'), label).toEqual([]);
			reasons[label] = ada.peer.last('uninvite')?.reason;
		};
		ask('far', kid('Far', beside(3)));
		ask('diagonal and far', kid('Diag', beside(3, 3)));
		ask('in a battle', kid('Battle', beside(1), 'battle'));
		ask('at the doctor', kid('Doc', beside(0, 1), 'doctor'));
		ask('in the menu', kid('Menu', beside(-1), 'menu'));
		ask('in a match', kid('Match', beside(1, 1), 'match'));
		ask('in another world', kid('Away', SPAWN, 'explore', 2));
		ask('on the water', kid('Sail', SHORE.water));
		ask('no team on land', kid('Crab', beside(1, -1)), [{ id: 'c', speciesId: 'crab' }]);
		reasons.self = (() => {
			vi.advanceTimersByTime(1_000);
			ada.peer.clear();
			ada.send({ t: 'challenge', pid: ada.pid, team: TEAM });
			return ada.peer.last('uninvite')?.reason;
		})();
		reasons.nobody = (() => {
			vi.advanceTimersByTime(1_000);
			ada.peer.clear();
			ada.send({ t: 'challenge', pid: 'nobody1', team: TEAM });
			return ada.peer.last('uninvite')?.reason;
		})();
		expect(reasons).toEqual({
			far: 'moved',
			'diagonal and far': 'moved',
			'in a battle': 'busy',
			'at the doctor': 'busy',
			'in the menu': 'busy',
			'in a match': 'busy',
			'in another world': 'gone',
			'on the water': 'moved',
			'no team on land': 'no-team',
			self: 'gone',
			nobody: 'gone'
		});
		// From the water, a player can't ask either: nothing to tell but that it didn't go.
		const sailor = kid('Sailor', SHORE.water);
		const shore = kid('Shore', SHORE.land);
		sailor.send({ t: 'challenge', pid: shore.pid, team: TEAM });
		expect(sailor.peer.last('uninvite')?.reason).toBe('off');
		expect(shore.peer.of('invite')).toEqual([]);
		expect(matches.size).toBe(0);
	});

	it('reaches two tiles every way, diagonals too', () => {
		const ada = kid('Ada');
		let n = 0;
		for (const [dx, dy] of [
			[2, 0],
			[-2, 0],
			[0, 2],
			[2, 2],
			[-2, -2],
			[1, 2]
		] as const) {
			if (wet(SPAWN.x + dx, SPAWN.y + dy)) continue;
			const other = kid(`K${n++}`, beside(dx, dy));
			ada.send({ t: 'challenge', pid: other.pid, team: TEAM });
			expect(other.peer.last('invite')?.pid, `${dx}, ${dy}`).toBe(ada.pid);
			ada.send({ t: 'withdraw' });
			vi.advanceTimersByTime(10_000);
		}
		expect(n).toBeGreaterThan(3);
	});

	it('ends after 20 s unanswered, and the challenger waits 30 s to ask again', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		vi.advanceTimersByTime(19_999);
		expect(ada.peer.of('uninvite')).toEqual([]);
		vi.advanceTimersByTime(1);
		expect(ada.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: bo.pid, reason: 'expired' });
		expect(bo.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: ada.pid, reason: 'expired' });
		// Too late now.
		bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
		expect(matches.size).toBe(0);
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('uninvite')?.reason).toBe('wait');
		vi.advanceTimersByTime(30_000);
		ada.peer.clear();
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('asking')?.pid).toBe(bo.pid);
	});

	it('after a No, the same challenger waits 30 s; anyone else may ask at once', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const cy = kid('Cy', beside(0, 1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		bo.send({ t: 'decline', pid: ada.pid });
		expect(ada.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: bo.pid, reason: 'no' });
		expect(bo.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: ada.pid, reason: 'off' });
		vi.advanceTimersByTime(29_000);
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('uninvite')?.reason).toBe('wait');
		cy.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(bo.peer.last('invite')?.pid).toBe(cy.pid);
		bo.send({ t: 'decline', pid: cy.pid });
		vi.advanceTimersByTime(1_000);
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(bo.peer.last('invite')?.pid).toBe(ada.pid);
	});

	it('taken back, says so to the one asked, and the challenger waits 10 s', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		ada.send({ t: 'withdraw' });
		expect(bo.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: ada.pid, reason: 'withdrawn' });
		expect(ada.peer.last('uninvite')?.reason).toBe('off');
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('uninvite')?.reason).toBe('wait');
		vi.advanceTimersByTime(10_000);
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(ada.peer.last('asking')).toBeDefined();
	});

	it('ends when the one asked walks away, sails off, meets a wild animal, travels or closes the game', () => {
		const cases: [string, (bo: Kid) => void, string][] = [
			['walks away', (bo) => bo.at(beside(3)), 'moved'],
			['onto the water', (bo) => bo.at(SHORE.water), 'moved'],
			['a wild battle', (bo) => bo.at(beside(1), { busy: 'battle' }), 'busy'],
			['the doctor', (bo) => bo.at(beside(1), { busy: 'doctor' }), 'busy'],
			['another world', (bo) => bo.at(SPAWN, { world: 5 }), 'gone'],
			['closes the game', (bo) => bo.leave(), 'gone']
		];
		for (const [label, act, reason] of cases) {
			setup();
			const ada = kid('Ada', label === 'onto the water' ? SHORE.land : SPAWN);
			const bo = kid('Bo', label === 'onto the water' ? SHORE.land : beside(1));
			ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
			act(bo);
			expect(ada.peer.last('uninvite'), label).toEqual({ t: 'uninvite', pid: bo.pid, reason });
			if (label !== 'closes the game') expect(bo.peer.last('uninvite')?.reason, label).toBe('off');
			bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
			expect(matches.size, label).toBe(0);
		}
		// Walking about within reach changes nothing.
		setup();
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		bo.at(beside(2, 1));
		bo.at(beside(-1, 2));
		expect(ada.peer.of('uninvite')).toEqual([]);
		bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
		expect(matches.size).toBe(1);
	});

	it('lets one player be asked by one challenger at a time; a second is told they are taken', () => {
		const bo = kid('Bo');
		const ada = kid('Ada', beside(1));
		const cy = kid('Cy', beside(-1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		cy.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		expect(cy.peer.last('uninvite')).toEqual({ t: 'uninvite', pid: bo.pid, reason: 'taken' });
		expect(bo.peer.of('invite').map((m) => m.pid)).toEqual([ada.pid]);
		// Nor can the challenger be asked meanwhile.
		cy.send({ t: 'challenge', pid: ada.pid, team: TEAM });
		expect(cy.peer.last('uninvite')?.reason).toBe('taken');
		// Nor ask anyone else, nor accept what was never asked.
		ada.send({ t: 'challenge', pid: cy.pid, team: TEAM });
		expect(ada.peer.last('uninvite')?.reason).toBe('off');
		cy.send({ t: 'accept', pid: bo.pid, team: TEAM });
		expect(cy.peer.last('uninvite')?.reason).toBe('off');
		bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
		expect(matches.size).toBe(1);
	});

	it('reads two players asking each other at once as a Yes', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		bo.send({ t: 'challenge', pid: ada.pid, team: [{ id: 'x', speciesId: 'frog' }] });
		expect(matches.size).toBe(1);
		expect(bo.peer.last('match')?.view.teams.b[0]!.speciesId).toBe('frog');
	});

	it('ends with a kind word when the one asked brings no animal that can fight on land', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({ t: 'challenge', pid: bo.pid, team: TEAM });
		bo.send({ t: 'accept', pid: ada.pid, team: [{ id: 'c', speciesId: 'crab' }] });
		expect(ada.peer.last('uninvite')?.reason).toBe('their-team');
		expect(bo.peer.last('uninvite')?.reason).toBe('no-team');
		expect(matches.size).toBe(0);
	});
});

describe('a match', () => {
	it('plays to the end, the same events to both, turns alternating, and nothing of an answer on the way', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		let latest = startedMatch(ada, bo);
		const id = latest.id;
		let turns = 0;
		while (latest.view.phase.kind !== 'ended') {
			const [me, them] = turnOf(latest, ada, bo);
			const phase = latest.view.phase;
			if (phase.kind === 'choose-animal') {
				const team = latest.view.teams[phase.side];
				const next = team.findIndex((a, i) => a.hp > 0 && i !== latest.view.active[phase.side]);
				me.send({ t: 'play', id, intent: { type: 'pick-next', teamIndex: next } });
			} else if (phase.kind === 'choose-action') {
				me.send({ t: 'play', id, intent: { type: 'attack', attackIndex: 1, level: 3 } });
			} else {
				me.send({ t: 'play', id, intent: { type: 'answer', input: answerOf(id) } });
			}
			const mine = me.peer.last('match')!;
			const theirs = them.peer.last('match')!;
			expect(mine.events).toEqual(theirs.events);
			expect(mine.view.step).toBe(theirs.view.step);
			latest = mine;
			if (++turns > 400) throw new Error('never ended');
		}
		expect(latest.view.phase).toMatchObject({ kind: 'ended', reason: 'all-tired' });
		// The waiting side saw each puzzle as it was asked, with nothing but its prompt.
		const shown = bo.peer
			.of('match')
			.flatMap((m) => m.events.filter((e) => e.type === 'puzzle-shown'));
		expect(shown.length).toBeGreaterThan(0);
		for (const e of shown)
			expect(Object.keys(e.type === 'puzzle-shown' ? e.puzzle : {}).sort()).toEqual([
				'difficulty',
				'kind',
				'prompt'
			]);
	});

	it('takes an intent only from the side whose turn it is, told to that page alone', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const [me, them] = turnOf(start, ada, bo);
		them.peer.clear();
		me.peer.clear();
		them.send({ t: 'play', id: start.id, intent: { type: 'attack', attackIndex: 1, level: 1 } });
		expect(them.peer.got).toEqual([{ t: 'rejected', id: start.id, reason: 'not-your-turn' }]);
		expect(me.peer.got).toEqual([]);
		// Another match's id, or none going on, is refused too.
		me.send({ t: 'play', id: 'nosuchmatch', intent: { type: 'leave' } });
		expect(me.peer.last('rejected')?.reason).toBe('match-over');
	});

	it('ends when either leaves, at any time, and the other wins', () => {
		for (const leaver of ['a', 'b'] as const) {
			setup();
			const ada = kid('Ada');
			const bo = kid('Bo', beside(1));
			const start = startedMatch(ada, bo);
			(leaver === 'a' ? ada : bo).send({ t: 'play', id: start.id, intent: { type: 'leave' } });
			for (const k of [ada, bo]) {
				expect(k.peer.last('match')?.view.phase).toEqual({
					kind: 'ended',
					winner: leaver === 'a' ? 'b' : 'a',
					reason: 'left'
				});
			}
		}
	});

	it('drops a rude nickname before the other page sees it', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		ada.send({
			t: 'challenge',
			pid: bo.pid,
			team: [{ id: 's', speciesId: 'squirrel', nickname: 'Fuckface' }]
		});
		bo.send({ t: 'accept', pid: ada.pid, team: TEAM });
		const text = JSON.stringify(bo.peer.got);
		expect(text).not.toMatch(/fuck/i);
		expect(bo.peer.last('match')?.view.teams.a[0]).toEqual({
			id: 'a:s',
			speciesId: 'squirrel',
			hp: getAnimal('squirrel').maxHp
		});
	});

	it('drops a page that sends more than its share of match messages', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const [me] = turnOf(start, ada, bo);
		me.peer.clear();
		for (let i = 0; i < 50; i++) {
			me.send({ t: 'play', id: start.id, intent: { type: 'switch', teamIndex: 5 } });
		}
		// The bucket holds 8, less the one the match's start took; the rest were dropped unread.
		expect(me.peer.of('rejected').length).toBeLessThanOrEqual(8);
		vi.advanceTimersByTime(1_000);
		me.send({ t: 'play', id: start.id, intent: { type: 'switch', teamIndex: 5 } });
		expect(me.peer.last('rejected')?.reason).toBe('no-such-animal');
	});
});

describe('dropping out', () => {
	it('waits 30 s for a page that dropped out, telling the other, then ends it: they had to go', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		bo.leave();
		expect(ada.peer.last('match')?.away).toEqual({ side: 'b', ms: 30_000 });
		vi.advanceTimersByTime(29_999);
		expect(ada.peer.last('match')?.view.phase.kind).not.toBe('ended');
		vi.advanceTimersByTime(1);
		const end = ada.peer.last('match')!;
		expect(end.view.phase).toEqual({ kind: 'ended', winner: 'a', reason: 'timed-out' });
		expect(end.timeout).toBe('dropped');
		expect(end.id).toBe(start.id);
		// Bo, back later, is in no match.
		const again = kid('Bo', beside(1));
		expect(again.hiMatch).toBeNull();
		expect(again.peer.of('match')).toEqual([]);
	});

	it('picks the match up for a page that comes back in time, where it stood, on either side', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const [me] = turnOf(start, ada, bo);
		me.send({ t: 'play', id: start.id, intent: { type: 'attack', attackIndex: 1, level: 1 } });
		bo.leave();
		vi.advanceTimersByTime(20_000);
		const back = kid('Bo', beside(1));
		expect(back.hiMatch).toBe(start.id);
		const resumed = back.peer.last('match')!;
		expect(resumed.view.you).toBe('b');
		expect(resumed.view.step).toBe(1);
		expect(resumed.view.phase.kind).toBe('solving');
		expect(ada.peer.last('match')?.away).toBeNull();
		vi.advanceTimersByTime(60_000);
		expect(ada.peer.last('match')?.view.phase.kind).toBe('solving');
	});

	it('plays on in a second window of the same player, and the first one closing changes nothing', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const firstPeer = bo.peer;
		// Bo's second window: the hub closes the first as it joins.
		const second = kid('Bo', beside(1));
		expect(second.hiMatch).toBe(start.id);
		matches.left(firstPeer);
		expect(ada.peer.last('match')?.away).toBeNull();
		vi.advanceTimersByTime(40_000);
		expect(ada.peer.last('match')?.view.phase.kind).not.toBe('ended');
	});
});

describe('the turn clock', () => {
	it('asks "Still there?" after 90 s, ends the match after 3 minutes, and any key starts it again', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const [me, them] = turnOf(start, ada, bo);
		vi.advanceTimersByTime(89_000);
		me.send({ t: 'here', id: start.id });
		vi.advanceTimersByTime(89_000);
		expect(me.peer.of('nudge')).toEqual([]);
		vi.advanceTimersByTime(1_000);
		expect(me.peer.of('nudge')).toEqual([{ t: 'nudge', id: start.id }]);
		expect(them.peer.of('nudge')).toEqual([]);
		// The waiting side's keys don't count for the side playing.
		them.send({ t: 'here', id: start.id });
		vi.advanceTimersByTime(90_000);
		const end = them.peer.last('match')!;
		expect(end.view.phase).toMatchObject({ kind: 'ended', reason: 'timed-out' });
		expect(end.timeout).toBe('idle');
	});

	it('starts over with each turn, so a slow kid who keeps answering is never ended', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		let latest = startedMatch(ada, bo);
		for (let i = 0; i < 6 && latest.view.phase.kind !== 'ended'; i++) {
			const [me] = turnOf(latest, ada, bo);
			vi.advanceTimersByTime(170_000);
			me.send({ t: 'play', id: latest.id, intent: { type: 'attack', attackIndex: 1, level: 1 } });
			vi.advanceTimersByTime(170_000);
			me.send({ t: 'play', id: latest.id, intent: { type: 'answer', input: '-1' } });
			latest = me.peer.last('match')!;
		}
		expect(latest.view.phase.kind).not.toBe('ended');
	});
});

describe('after a match', () => {
	function ended(ada: Kid, bo: Kid): MatchMessage {
		const start = startedMatch(ada, bo);
		ada.send({ t: 'play', id: start.id, intent: { type: 'leave' } });
		// Ada left, so she is back exploring; Bo is on the result.
		return bo.peer.last('match')!;
	}

	it('starts a rematch once both say yes, with a new seed and id', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const start = startedMatch(ada, bo);
		const [me] = turnOf(start, ada, bo);
		me.send({ t: 'play', id: start.id, intent: { type: 'attack', attackIndex: 1, level: 1 } });
		// End it by leaving, both staying on the result (Ada's page keeps saying "match").
		ada.send({ t: 'play', id: start.id, intent: { type: 'leave' } });
		ada.at(SPAWN, { busy: 'match' });
		bo.at(beside(1), { busy: 'match' });
		ada.send({ t: 'rematch', id: start.id, team: TEAM });
		expect(bo.peer.last('rematch-wish')).toEqual({
			t: 'rematch-wish',
			id: start.id,
			side: 'a',
			yes: true
		});
		expect(ada.peer.last('rematch-wish')?.yes).toBe(true);
		bo.send({ t: 'rematch', id: start.id, team: [{ id: 'f', speciesId: 'fox' }] });
		const next = ada.peer.last('match')!;
		expect(next.id).not.toBe(start.id);
		expect(next.view.step).toBe(0);
		expect(next.view.teams.b[0]!.speciesId).toBe('fox');
		expect(matches.size).toBe(1);
	});

	it('is off when either goes back to exploring, or after two minutes', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const end = ended(ada, bo);
		ada.at(SPAWN, { busy: 'explore' });
		expect(bo.peer.last('rematch-wish')).toEqual({
			t: 'rematch-wish',
			id: end.id,
			side: 'a',
			yes: false
		});
		bo.send({ t: 'rematch', id: end.id, team: TEAM });
		expect(bo.peer.last('rematch-wish')?.yes).toBe(false);
		bo.at(beside(1), { busy: 'explore' });
		expect(matches.size).toBe(0);

		setup();
		const cy = kid('Cy');
		const di = kid('Di', beside(1));
		const start = startedMatch(cy, di);
		cy.send({ t: 'play', id: start.id, intent: { type: 'leave' } });
		cy.at(SPAWN, { busy: 'match' });
		di.at(beside(1), { busy: 'match' });
		vi.advanceTimersByTime(120_000);
		expect(cy.peer.last('rematch-wish')).toMatchObject({ side: 'b', yes: false });
		expect(matches.size).toBe(0);
		expect(matches.known).toBe(2);
	});
});

describe('every way out', () => {
	it('leaves no timer and nobody behind: ends, timeouts, closed sockets and a stop', () => {
		const ada = kid('Ada');
		const bo = kid('Bo', beside(1));
		const cy = kid('Cy', beside(-1));
		const di = kid('Di', beside(0, 1));
		const start = startedMatch(ada, bo);
		cy.send({ t: 'challenge', pid: di.pid, team: TEAM });
		expect(vi.getTimerCount()).toBeGreaterThan(0);
		matches.stop();
		expect(vi.getTimerCount()).toBe(0);
		expect(matches.size).toBe(0);
		expect(matches.known).toBe(0);
		// A message about a match that is gone is refused, and starts nothing.
		ada.send({ t: 'play', id: start.id, intent: { type: 'leave' } });
		expect(vi.getTimerCount()).toBe(0);

		// Everybody closes their game: everything is forgotten once the waits are over.
		setup();
		const e = kid('E');
		const f = kid('F', beside(1));
		startedMatch(e, f);
		const g = kid('G', beside(-1));
		const h = kid('H', beside(-1, 1));
		g.send({ t: 'challenge', pid: h.pid, team: TEAM });
		for (const k of [e, f, g, h]) k.leave();
		vi.advanceTimersByTime(200_000);
		expect(matches.size).toBe(0);
		expect(matches.known).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});
