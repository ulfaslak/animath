import {
	MATCH_SIDES,
	MAX_ROSTER,
	MAX_SERVER_MESSAGE_BYTES,
	bearingTo,
	inView,
	roughSteps,
	type ByeReason,
	type FightEvent,
	type FightMessage,
	type FightView,
	type GridPos,
	type MatchSide,
	type PeerMessage,
	type RosterEntry,
	type ServerMessage,
	type WhereMessage,
	type LandId
} from '@mathgame/engine';

/**
 * Presence: who is in which world, where, and what they are doing
 * ([[DECISIONS]]: the server is the authority for what two players share).
 * Kept in memory only; a restart forgets everyone, and every browser comes
 * back on its own and says where it is again.
 *
 * A room is a world. A socket joins one by saying where it is (`where`), and
 * is in exactly one room from then on, or none: saying another world moves
 * it, and leaving takes it out. Two players in a room see each other's
 * every change while they are near (`inView`), and the server keeps that
 * pairwise, both ways at once: either both see the other, or neither does.
 * Everyone else in the room is on the roster, roughly (`rosterFor`), sent
 * every couple of seconds when it changed.
 *
 * One identity is present once: a second socket for the same guest or
 * account takes the first one's place, and the first is closed (`replaced`).
 *
 * A player in a battle is seen in it ([[PRODUCT]] §4 "Playing together"):
 * the hub keeps how their battle stands (`Showing`, the engine's
 * `FightView`), passes every step of it to the players who see them, and
 * gives it to anyone who comes near later, so a late arrival sees the
 * battle at once. A wild battle is its fighter's page's to report (`battle`),
 * and only while that page says it is in one; a friendly match is the
 * server's own (`match`, from `matches.ts`), seen round both its players and
 * never by them. Nothing of it is kept past its end.
 *
 * The hub decides everything and does no I/O: a `Peer` is how it talks to
 * one socket (`socket.ts` wires it to `ws`; the tests to a list).
 */

/** What the hub needs from one socket. */
export interface Peer {
	send(message: ServerMessage): void;
	/** Say `bye` with the reason, then close. The hub has already forgotten the socket. */
	close(reason: ByeReason): void;
}

/**
 * A room: one land of one world ([[DECISIONS]] § Multiplayer, #191). Players
 * see each other only in the same land of the same world: Nordland 42 and
 * Arktis 42 are two rooms.
 */
interface Room {
	readonly world: number;
	readonly land: LandId;
	/** `placeKey(land, world)`, its key among the rooms. */
	readonly key: string;
	readonly members: Set<Member>;
}

/** A room's key: its land and world, as `nordland:42`. */
export function placeKey(land: LandId, world: number): string {
	return `${land}:${world}`;
}

/** Where a member stands and what the others see of them: `where` without its kind, world and land. */
export type Spot = Omit<WhereMessage, 't' | 'world' | 'land'>;

/**
 * A player who said hello, as the friendly matches read them (`matches.ts`):
 * their socket, public id, who they are (never sent), name, and the world,
 * land and spot their last `where` named (null before the first).
 */
export interface Present {
	readonly peer: Peer;
	readonly pid: string;
	readonly key: string;
	readonly name: string;
	readonly world: number | null;
	readonly land: LandId | null;
	readonly spot: Spot | null;
}

/**
 * A battle as the players near it see it, while it goes on: whose it is
 * (the fighter, or a match's side `a`, with side `b` as `vs`) and how it
 * stands. A match's is one object, kept on both its players.
 */
interface Showing {
	readonly pid: string;
	readonly vs: string | null;
	readonly view: FightView;
}

interface Member {
	readonly peer: Peer;
	readonly pid: string;
	/** `guest:<id>` or `account:<id>`: who this is, never sent to anyone. */
	readonly key: string;
	readonly name: string;
	room: Room | null;
	spot: Spot | null;
	/** The members this one sees, and so who see it: the relation is kept both ways at once. */
	readonly sees: Set<Member>;
	/** The last roster sent, as sent, so an unchanged one is not sent again. */
	lastRoster: string;
	/** The battle this player is in, as the players near them see it; null when there is none to see. */
	showing: Showing | null;
}

export interface HubOptions {
	/**
	 * The public id for an identity, `attempt` 0 first: the same identity
	 * gets the same one again while the server runs, so a player whose socket
	 * came back is the same player to everyone (another attempt when the
	 * first is somebody else's, which a good hash makes all but never).
	 */
	pidFor: (key: string, attempt: number) => string;
	/** The most players one land of one world holds; one more is turned away (`full`). */
	maxPerWorld?: number;
}

export class PresenceHub {
	private readonly rooms = new Map<string, Room>();
	private readonly byPeer = new Map<Peer, Member>();
	private readonly byKey = new Map<string, Member>();
	private readonly byPid = new Map<string, Member>();
	private readonly maxPerWorld: number;

	constructor(private readonly options: HubOptions) {
		this.maxPerWorld = options.maxPerWorld ?? 200;
	}

	/** Sockets that have said hello. */
	get size(): number {
		return this.byPeer.size;
	}

	/** The rooms with anyone in them, by `placeKey` (`nordland:42`), and how many: for tests and logs. */
	places(): Map<string, number> {
		return new Map([...this.rooms].map(([key, room]) => [key, room.members.size]));
	}

	/**
	 * A socket said hello as `key` (a guest id or an account), called `name`
	 * (already checked). An earlier socket of the same identity leaves and is
	 * closed (`replaced`) first, so nobody is drawn twice. Answers `hi`.
	 */
	join(peer: Peer, key: string, name: string): string {
		if (this.byPeer.has(peer)) throw new Error('join: this socket has joined already');
		const earlier = this.byKey.get(key);
		if (earlier) {
			this.leave(earlier.peer);
			earlier.peer.close('replaced');
		}
		let pid = this.options.pidFor(key, 0);
		for (let attempt = 1; this.byPid.has(pid); attempt++) pid = this.options.pidFor(key, attempt);
		const member: Member = {
			peer,
			pid,
			key,
			name,
			room: null,
			spot: null,
			sees: new Set(),
			lastRoster: '',
			showing: null
		};
		this.byPeer.set(peer, member);
		this.byKey.set(key, member);
		this.byPid.set(pid, member);
		return pid;
	}

	/** Whether the socket has said hello (and not left). */
	has(peer: Peer): boolean {
		return this.byPeer.has(peer);
	}

	/** The player on this socket, if it said hello and has not left. */
	present(peer: Peer): Present | null {
		const member = this.byPeer.get(peer);
		return member ? presentOf(member) : null;
	}

	/** The player with this public id, if one is here. */
	presentByPid(pid: string): Present | null {
		const member = this.byPid.get(pid);
		return member ? presentOf(member) : null;
	}

	/**
	 * Where a member is now: into the room of that land of that world (out of
	 * any other), and then to everyone near, both ways. A full room turns them
	 * away: they leave, and their socket is closed (`full`).
	 */
	where(peer: Peer, where: WhereMessage): void {
		const member = this.byPeer.get(peer);
		if (!member) return;
		const { t: _t, world, land, ...spot } = where;
		const key = placeKey(land, world);
		if (member.room?.key !== key) {
			const room = this.rooms.get(key);
			if (room && room.members.size >= this.maxPerWorld) {
				this.leave(peer);
				peer.close('full');
				return;
			}
			// Everyone it saw in the world it leaves goes from its screen too.
			this.leaveRoom(member, true);
			member.spot = spot;
			this.enter(member, world, land);
		} else {
			member.spot = spot;
		}
		// A wild battle is seen while its page says it is in one: back to exploring (or up in
		// the air, or anywhere else), there is nothing more to see of it.
		if (member.showing?.vs === null && spot.busy !== 'battle') member.showing = null;
		this.refreshSight(member);
		if (member.room && member.lastRoster === '') this.sendRoster(member);
	}

	/**
	 * A page's report of its own battle with a wild animal: how it stands and
	 * what just happened. Taken only while the page says it is in a battle
	 * (its last `where`); kept for whoever comes near later, and passed on now
	 * to everyone who sees the player. A report that says the battle ended is
	 * passed on, so the others see the end, and then there is nothing to keep.
	 */
	battle(peer: Peer, view: FightView, events: FightEvent[]): void {
		const member = this.byPeer.get(peer);
		if (!member?.room || member.spot?.busy !== 'battle') return;
		// A player in a friendly match is seen in it as the server says, never as their page says.
		if (member.showing && member.showing.vs !== null) return;
		const ended = events.some((e) => e.type === 'ended');
		member.showing = ended ? null : { pid: member.pid, vs: null, view };
		const message: FightMessage = { t: 'fight', pid: member.pid, vs: null, view, events };
		for (const other of member.sees) other.peer.send(message);
	}

	/**
	 * A friendly match as the server's own state says it stands
	 * (`matches.ts`): kept on both its players for whoever comes near later,
	 * and passed on, once, to everyone who sees either of them, never to the
	 * two themselves. `view` null, or events that say it ended: after this
	 * there is nothing to keep. A player whose page is away is simply not
	 * here (`peers`).
	 */
	match(
		peers: Record<MatchSide, Peer | null>,
		pids: Record<MatchSide, string>,
		view: FightView | null,
		events: FightEvent[]
	): void {
		const members: Member[] = [];
		for (const side of MATCH_SIDES) {
			const peer = peers[side];
			const member = peer ? this.byPeer.get(peer) : undefined;
			if (member) members.push(member);
		}
		const over = view === null || events.some((e) => e.type === 'ended');
		const showing = over ? null : { pid: pids.a, vs: pids.b, view };
		for (const member of members) {
			// Over, only this match's view goes: a battle its player went on to stays theirs.
			const mine = member.showing?.pid === pids.a && member.showing.vs === pids.b;
			if (showing || mine) member.showing = showing;
		}
		if (view === null) return;
		const message: FightMessage = { t: 'fight', pid: pids.a, vs: pids.b, view, events };
		const told = new Set<Member>(members);
		for (const member of members) {
			for (const other of member.sees) {
				// Never one of its own players, even on a page the match has not heard is back.
				if (told.has(other) || other.pid === pids.a || other.pid === pids.b) continue;
				told.add(other);
				other.peer.send(message);
			}
		}
	}

	/** "Where exactly is this player?": `found` in the asker's world, else `lost`. */
	find(peer: Peer, pid: string): void {
		const member = this.byPeer.get(peer);
		if (!member) return;
		const target = this.byPid.get(pid);
		if (target && target !== member && target.room && target.room === member.room && target.spot) {
			peer.send({ t: 'found', pid, x: target.spot.x, y: target.spot.y });
		} else {
			peer.send({ t: 'lost', pid });
		}
	}

	/** The socket is gone, or going: out of its world, everyone who saw it told. Safe to call twice. */
	leave(peer: Peer): void {
		const member = this.byPeer.get(peer);
		if (!member) return;
		this.leaveRoom(member);
		this.byPeer.delete(peer);
		this.byPid.delete(member.pid);
		if (this.byKey.get(member.key) === member) this.byKey.delete(member.key);
	}

	/** Everyone's roster, to each one whose roster changed since the last they were sent. */
	sendRosters(): void {
		for (const room of this.rooms.values()) {
			for (const member of room.members) this.sendRoster(member);
		}
	}

	/**
	 * Everyone else in `member`'s world who has said where they are, nearest
	 * first, at most `MAX_ROSTER`: their name, which way they are and about
	 * how far, and what they are doing.
	 */
	rosterFor(member: { room: Room | null; spot: Spot | null }): RosterEntry[] {
		const from = member.spot;
		if (!member.room || !from) return [];
		const others: { entry: RosterEntry; apart: number }[] = [];
		for (const other of member.room.members) {
			if (other === member || !other.spot) continue;
			others.push({
				entry: {
					pid: other.pid,
					name: other.name,
					bearing: bearingTo(from, other.spot),
					steps: roughSteps(from, other.spot),
					busy: other.spot.busy
				},
				apart: steps(from, other.spot)
			});
		}
		others.sort((a, b) => a.apart - b.apart || (a.entry.pid < b.entry.pid ? -1 : 1));
		return others.slice(0, MAX_ROSTER).map((o) => o.entry);
	}

	/** Who `peer` sees now, by public id: for tests. */
	seenBy(peer: Peer): string[] {
		return [...(this.byPeer.get(peer)?.sees ?? [])].map((m) => m.pid).sort();
	}

	// --- rooms ------------------------------------------------------------------

	private enter(member: Member, world: number, land: LandId): void {
		const key = placeKey(land, world);
		let room = this.rooms.get(key);
		if (!room) {
			room = { world, land, key, members: new Set() };
			this.rooms.set(key, room);
		}
		room.members.add(member);
		member.room = room;
		member.lastRoster = '';
	}

	/**
	 * Out of its room, if in one: everyone who saw it is told it has gone
	 * (and, `tellItself`, it that they have), and the room goes when empty.
	 */
	private leaveRoom(member: Member, tellItself = false): void {
		for (const other of member.sees) {
			other.sees.delete(member);
			other.peer.send({ t: 'gone', pid: member.pid });
			if (tellItself) member.peer.send({ t: 'gone', pid: other.pid });
		}
		member.sees.clear();
		const room = member.room;
		// A page back in its match is shown it before it says where it is (in no room yet):
		// that is its first room, and the match is where it will be.
		if (!room) return;
		// A battle is fought where it started: out of that world, there is none to see.
		member.showing = null;
		room.members.delete(member);
		if (room.members.size === 0) this.rooms.delete(room.key);
		member.room = null;
		member.lastRoster = '';
	}

	/**
	 * After `member` moved or changed: everyone near sees it as it is now, and
	 * it sees them; anyone no longer near is told it has gone, and it them.
	 */
	private refreshSight(member: Member): void {
		const room = member.room;
		const at = member.spot;
		if (!room || !at) return;
		// The battles `member` was shown now: a match's players, both come into view at once, show it once.
		const shown = new Set<Showing>();
		for (const other of room.members) {
			if (other === member || !other.spot) continue;
			const seeing = member.sees.has(other);
			if (inView(at, other.spot, seeing)) {
				other.peer.send(peerMessage(member, at));
				if (!seeing) {
					member.sees.add(other);
					other.sees.add(member);
					member.peer.send(peerMessage(other, other.spot));
					// Each sees the other's battle as it stands, at once: both animals, and the puzzle.
					showTo(other, member.showing);
					if (other.showing && !shown.has(other.showing)) {
						shown.add(other.showing);
						showTo(member, other.showing);
					}
				}
			} else if (seeing) {
				member.sees.delete(other);
				other.sees.delete(member);
				other.peer.send({ t: 'gone', pid: member.pid });
				member.peer.send({ t: 'gone', pid: other.pid });
			}
		}
	}

	private sendRoster(member: Member): void {
		if (!member.room || !member.spot) return;
		const { world, land } = member.room;
		const players = fitRoster(world, land, this.rosterFor(member));
		const text = JSON.stringify(players);
		if (text === member.lastRoster) return;
		member.lastRoster = text;
		member.peer.send({ t: 'roster', world, land, players });
	}
}

/**
 * The roster as far as it fits in `MAX_SERVER_MESSAGE_BYTES`, nearest first:
 * names the wire takes can be long in JSON, and a browser drops a message
 * longer than it reads.
 */
function fitRoster(world: number, land: LandId, players: RosterEntry[]): RosterEntry[] {
	// The message is its frame round '[]' plus each entry, a comma between.
	let length = JSON.stringify({ t: 'roster', world, land, players: [] }).length;
	let fits = 0;
	for (const entry of players) {
		length += JSON.stringify(entry).length + (fits > 0 ? 1 : 0);
		if (length > MAX_SERVER_MESSAGE_BYTES) break;
		fits++;
	}
	return fits === players.length ? players : players.slice(0, fits);
}

function presentOf(member: Member): Present {
	return {
		peer: member.peer,
		pid: member.pid,
		key: member.key,
		name: member.name,
		world: member.room?.world ?? null,
		land: member.room?.land ?? null,
		spot: member.spot
	};
}

function peerMessage(member: Member, spot: Spot): PeerMessage {
	return { t: 'peer', pid: member.pid, name: member.name, ...spot };
}

/** A battle as it stands, to someone who just came near it: never to one of its own players. */
function showTo(member: Member, showing: Showing | null): void {
	if (!showing || member.pid === showing.pid || member.pid === showing.vs) return;
	member.peer.send({
		t: 'fight',
		pid: showing.pid,
		vs: showing.vs,
		view: showing.view,
		events: []
	});
}

/** Steps apart on the grid, exactly, for sorting the roster (it shows them rounded). */
function steps(a: GridPos, b: GridPos): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
