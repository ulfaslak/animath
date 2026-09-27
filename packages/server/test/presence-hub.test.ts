import {
	BUSY_STATES,
	MAX_ROSTER,
	Rng,
	VIEW_KEEP,
	VIEW_RADIUS,
	parseServerMessage,
	tilesApart,
	type ByeReason,
	type ServerMessage,
	type WhereMessage
} from '@mathgame/engine';
import { describe, expect, it } from 'vitest';
import { PresenceHub, type Peer } from '../src/presence/hub.js';

// The hub is all the presence rules without a socket: these tests drive it
// with fake peers that keep what they are sent, and check it against the
// rules, and against what a browser would believe from those messages.

class FakePeer implements Peer {
	readonly got: ServerMessage[] = [];
	closed: ByeReason | null = null;
	/** The public id `join` gave it (the property test keeps it here). */
	pid = '';
	private readonly drawing = new Map<string, ServerMessage & { t: 'peer' }>();
	send(message: ServerMessage): void {
		// Everything sent must be a message a browser reads as one.
		expect(parseServerMessage(JSON.parse(JSON.stringify(message)))).toEqual(message);
		this.got.push(message);
		if (message.t === 'peer') this.drawing.set(message.pid, message);
		if (message.t === 'gone') this.drawing.delete(message.pid);
	}
	close(reason: ByeReason): void {
		this.closed = reason;
	}
	/** The players this browser draws: every `peer` it got and no `gone` since. */
	drawn(): ReadonlyMap<string, ServerMessage & { t: 'peer' }> {
		return this.drawing;
	}
	of<T extends ServerMessage['t']>(t: T): Extract<ServerMessage, { t: T }>[] {
		return this.got.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
	}
}

/** Public ids as the server makes them, without the salt: the same identity, the same id. */
function newHub(maxPerWorld?: number): PresenceHub {
	return new PresenceHub({
		pidFor: (key, attempt) => `pid-${attempt}-${key.replace(/[^A-Za-z0-9]/g, '')}`.slice(0, 32),
		maxPerWorld
	});
}

function where(
	world: number,
	x: number,
	y: number,
	patch: Partial<WhereMessage> = {}
): WhereMessage {
	return {
		t: 'where',
		world,
		x,
		y,
		facing: 'down',
		lead: 'squirrel',
		boat: false,
		busy: 'explore',
		...patch
	};
}

describe('presence hub', () => {
	it('shows two players near each other to each other, and neither to a third far away', () => {
		const hub = newHub();
		const [a, b, c] = [new FakePeer(), new FakePeer(), new FakePeer()];
		const pa = hub.join(a, 'guest:a', 'Ada');
		const pb = hub.join(b, 'guest:b', 'Bo');
		hub.join(c, 'guest:c', 'Cy');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(1, 3, -2));
		hub.where(c, where(1, 500, 0));
		expect([...a.drawn().keys()]).toEqual([pb]);
		expect([...b.drawn().keys()]).toEqual([pa]);
		expect(c.drawn().size).toBe(0);
		expect(b.drawn().get(pa)).toMatchObject({ name: 'Ada', x: 0, y: 0, lead: 'squirrel' });
		// Every change is passed on while they are near.
		hub.where(a, where(1, 1, 0, { busy: 'battle', facing: 'right' }));
		expect(b.drawn().get(pa)).toMatchObject({ x: 1, busy: 'battle', facing: 'right' });
	});

	it('keeps worlds apart, and moves a player from one world to another', () => {
		const hub = newHub();
		const [a, b] = [new FakePeer(), new FakePeer()];
		const pa = hub.join(a, 'guest:a', 'Ada');
		hub.join(b, 'guest:b', 'Bo');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(2, 0, 0));
		expect(a.drawn().size + b.drawn().size).toBe(0);
		expect(hub.worlds()).toEqual(
			new Map([
				[1, 1],
				[2, 1]
			])
		);
		// Ada travels to world 2: she is there, next to Bo, and world 1 is empty.
		hub.where(a, where(2, 1, 0));
		expect(hub.worlds()).toEqual(new Map([[2, 2]]));
		expect([...b.drawn().keys()]).toEqual([pa]);
		// And back: Bo is told she has gone.
		hub.where(a, where(1, 1, 0));
		expect(b.drawn().size).toBe(0);
		expect(b.of('gone').at(-1)).toEqual({ t: 'gone', pid: pa });
	});

	it('lets a player go out of sight only past the keep distance, and comes back within the radius', () => {
		const hub = newHub();
		const [a, b] = [new FakePeer(), new FakePeer()];
		hub.join(a, 'guest:a', 'Ada');
		const pb = hub.join(b, 'guest:b', 'Bo');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(1, VIEW_RADIUS + 1, 0));
		expect(a.drawn().has(pb)).toBe(false);
		hub.where(b, where(1, VIEW_RADIUS, 0));
		expect(a.drawn().has(pb)).toBe(true);
		hub.where(b, where(1, VIEW_KEEP, 0));
		expect(a.drawn().has(pb)).toBe(true);
		hub.where(b, where(1, VIEW_KEEP + 1, 0));
		expect(a.drawn().has(pb)).toBe(false);
	});

	it('tells everyone who saw a player that they left, once', () => {
		const hub = newHub();
		const [a, b] = [new FakePeer(), new FakePeer()];
		const pa = hub.join(a, 'guest:a', 'Ada');
		hub.join(b, 'guest:b', 'Bo');
		hub.where(a, where(3, 0, 0));
		hub.where(b, where(3, 1, 1));
		hub.leave(a);
		hub.leave(a);
		expect(b.drawn().size).toBe(0);
		expect(b.of('gone')).toEqual([{ t: 'gone', pid: pa }]);
		expect(hub.size).toBe(1);
		// A socket that left can say nothing more.
		hub.where(a, where(3, 1, 1));
		expect(b.drawn().size).toBe(0);
	});

	it("keeps one presence per identity: a second socket takes the first one's place", () => {
		const hub = newHub();
		const [first, second, friend] = [new FakePeer(), new FakePeer(), new FakePeer()];
		const old = hub.join(first, 'guest:same', 'Ada');
		hub.join(friend, 'guest:friend', 'Bo');
		hub.where(first, where(1, 0, 0));
		hub.where(friend, where(1, 2, 0));
		const now = hub.join(second, 'guest:same', 'Ada');
		expect(first.closed).toBe('replaced');
		// The same player, the same public id: to everyone else it is her, back.
		expect(now).toBe(old);
		// The friend never draws two of her: the old one went first.
		expect(friend.drawn().size).toBe(0);
		hub.where(second, where(1, 1, 0));
		expect([...friend.drawn().keys()]).toEqual([now]);
		// The old socket's goodbye, when it comes, changes nothing.
		hub.leave(first);
		expect([...friend.drawn().keys()]).toEqual([now]);
		expect(hub.size).toBe(2);
		// An account is one identity too, across guests ids.
		const [p, q] = [new FakePeer(), new FakePeer()];
		hub.join(p, 'account:7', 'Nini');
		hub.join(q, 'account:7', 'Nini');
		expect(p.closed).toBe('replaced');
		expect(q.closed).toBe(null);
	});

	it('answers where a player is, only to someone in the same world', () => {
		const hub = newHub();
		const [a, b, c] = [new FakePeer(), new FakePeer(), new FakePeer()];
		hub.join(a, 'guest:a', 'Ada');
		const pb = hub.join(b, 'guest:b', 'Bo');
		hub.join(c, 'guest:c', 'Cy');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(1, -600, 40));
		hub.where(c, where(2, 0, 0));
		hub.find(a, pb);
		expect(a.of('found')).toEqual([{ t: 'found', pid: pb, x: -600, y: 40 }]);
		hub.find(c, pb);
		expect(c.of('lost')).toEqual([{ t: 'lost', pid: pb }]);
		hub.find(a, 'nobody00');
		expect(a.of('lost')).toEqual([{ t: 'lost', pid: 'nobody00' }]);
	});

	it('sends each player a roster of everyone else in the world, nearest first, when it changed', () => {
		const hub = newHub();
		const [a, b, c, d] = [new FakePeer(), new FakePeer(), new FakePeer(), new FakePeer()];
		hub.join(a, 'guest:a', 'Ada');
		const pb = hub.join(b, 'guest:b', 'Bo');
		const pc = hub.join(c, 'guest:c', 'Cy');
		hub.join(d, 'guest:d', 'Di');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(1, 0, -117, { busy: 'doctor' }));
		hub.where(c, where(1, 30, 0));
		hub.where(d, where(9, 0, 0));
		hub.sendRosters();
		const roster = a.of('roster').at(-1)!;
		expect(roster.world).toBe(1);
		expect(roster.players).toEqual([
			{ pid: pc, name: 'Cy', bearing: 4, steps: 30, busy: 'explore' },
			{ pid: pb, name: 'Bo', bearing: 0, steps: 120, busy: 'doctor' }
		]);
		// Nothing changed: nothing sent.
		const count = a.of('roster').length;
		hub.sendRosters();
		expect(a.of('roster').length).toBe(count);
		// Bo walks a step: still "about 120", so nothing new either; a new busy is.
		hub.where(b, where(1, 0, -118, { busy: 'doctor' }));
		hub.sendRosters();
		expect(a.of('roster').length).toBe(count);
		hub.where(b, where(1, 0, -118, { busy: 'menu' }));
		hub.sendRosters();
		expect(a.of('roster').at(-1)!.players[1]!.busy).toBe('menu');
	});

	it('lists at most the nearest MAX_ROSTER', () => {
		const hub = newHub();
		const me = new FakePeer();
		hub.join(me, 'guest:me', 'Me');
		hub.where(me, where(1, 0, 0));
		for (let i = 0; i < MAX_ROSTER + 10; i++) {
			const p = new FakePeer();
			hub.join(p, `guest:${i}`, `P${i}`);
			hub.where(p, where(1, 100 + i, 0));
		}
		hub.sendRosters();
		const players = me.of('roster').at(-1)!.players;
		expect(players).toHaveLength(MAX_ROSTER);
		expect(players.at(-1)!.name).toBe(`P${MAX_ROSTER - 1}`);
	});

	it('turns a player away from a full world', () => {
		const hub = newHub(2);
		const [a, b, c] = [new FakePeer(), new FakePeer(), new FakePeer()];
		hub.join(a, 'guest:a', 'Ada');
		hub.join(b, 'guest:b', 'Bo');
		hub.join(c, 'guest:c', 'Cy');
		hub.where(a, where(1, 0, 0));
		hub.where(b, where(1, 0, 0));
		hub.where(c, where(1, 0, 0));
		expect(c.closed).toBe('full');
		expect(hub.worlds()).toEqual(new Map([[1, 2]]));
		expect(a.drawn().size).toBe(1);
	});

	it('keeps sight both ways, within one world, and every browser draws exactly who it sees', () => {
		const rng = new Rng(2027);
		for (let run = 0; run < 20; run++) {
			const hub = newHub();
			const peers: FakePeer[] = [];
			const spots = new Map<FakePeer, WhereMessage>();
			for (let op = 0; op < 400; op++) {
				const roll = rng.next();
				if (roll < 0.1 || peers.length < 2) {
					const p = new FakePeer();
					// Now and then the same identity again: it takes the old one's place.
					const key = `guest:${rng.int(0, 12)}`;
					p.pid = hub.join(p, key, `K${key}`);
					for (const q of peers) if (q.closed) spots.delete(q);
					peers.push(p);
				} else if (roll < 0.15) {
					const p = peers[rng.int(0, peers.length - 1)]!;
					hub.leave(p);
					spots.delete(p);
				} else {
					const p = peers[rng.int(0, peers.length - 1)]!;
					if (!hub.has(p)) continue;
					const old = spots.get(p);
					const w =
						old && rng.chance(0.9)
							? where(old.world, old.x + rng.int(-3, 3), old.y + rng.int(-3, 3), {
									busy: BUSY_STATES[rng.int(0, BUSY_STATES.length - 1)]!
								})
							: where(rng.int(1, 3), rng.int(-40, 40), rng.int(-40, 40));
					hub.where(p, w);
					if (hub.has(p)) spots.set(p, w);
				}
				// The rules, after every step (checked without `expect` in the loop: it is hot).
				const live = peers.filter((p) => hub.has(p));
				const broken: string[] = [];
				const check = (ok: boolean, rule: string) => {
					if (!ok) broken.push(`run ${run} op ${op}: ${rule}`);
				};
				for (const p of live) {
					for (const q of live) {
						if (p === q) continue;
						const [sp, sq] = [spots.get(p), spots.get(q)];
						const pSeesQ = p.drawn().has(q.pid);
						check(pSeesQ === q.drawn().has(p.pid), 'sight is both ways');
						if (!sp || !sq || sp.world !== sq.world) {
							check(!pSeesQ, 'nobody sees into another world');
							continue;
						}
						const apart = tilesApart(sp, sq);
						check(apart > VIEW_RADIUS || pSeesQ, 'near players see each other');
						check(apart <= VIEW_KEEP || !pSeesQ, 'far players do not');
						// What a browser draws is where the other one is now, as they are.
						const drawn = p.drawn().get(q.pid);
						check(
							!pSeesQ || (drawn?.x === sq.x && drawn.y === sq.y && drawn.busy === sq.busy),
							'drawn as they are'
						);
					}
					// The hub's own record agrees with what the browser was told, and no
					// browser draws anyone who has left.
					check(
						hub.seenBy(p).join() === [...p.drawn().keys()].sort().join(),
						'the browser draws who the hub says it sees'
					);
				}
				expect(broken).toEqual([]);
			}
		}
	});
});
