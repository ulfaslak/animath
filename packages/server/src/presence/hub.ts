import {
	MAX_ROSTER,
	bearingTo,
	inView,
	roughSteps,
	type ByeReason,
	type GridPos,
	type PeerMessage,
	type RosterEntry,
	type ServerMessage,
	type WhereMessage
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
 * The hub decides everything and does no I/O: a `Peer` is how it talks to
 * one socket (`socket.ts` wires it to `ws`; the tests to a list).
 */

/** What the hub needs from one socket. */
export interface Peer {
	send(message: ServerMessage): void;
	/** Say `bye` with the reason, then close. The hub has already forgotten the socket. */
	close(reason: ByeReason): void;
}

interface Room {
	readonly world: number;
	readonly members: Set<Member>;
}

/** Where a member stands and what the others see of them: `where` without its kind and world. */
type Spot = Omit<WhereMessage, 't' | 'world'>;

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
}

export interface HubOptions {
	/**
	 * The public id for an identity, `attempt` 0 first: the same identity
	 * gets the same one again while the server runs, so a player whose socket
	 * came back is the same player to everyone (another attempt when the
	 * first is somebody else's, which a good hash makes all but never).
	 */
	pidFor: (key: string, attempt: number) => string;
	/** The most players one world holds; one more is turned away (`full`). */
	maxPerWorld?: number;
}

export class PresenceHub {
	private readonly rooms = new Map<number, Room>();
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

	/** The worlds with anyone in them, and how many: for tests and logs. */
	worlds(): Map<number, number> {
		return new Map([...this.rooms].map(([world, room]) => [world, room.members.size]));
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
			lastRoster: ''
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

	/**
	 * Where a member is now: into that world's room (out of any other), and
	 * then to everyone near, both ways. A full world turns them away: they
	 * leave, and their socket is closed (`full`).
	 */
	where(peer: Peer, where: WhereMessage): void {
		const member = this.byPeer.get(peer);
		if (!member) return;
		const { t: _t, world, ...spot } = where;
		if (member.room?.world !== world) {
			const room = this.rooms.get(world);
			if (room && room.members.size >= this.maxPerWorld) {
				this.leave(peer);
				peer.close('full');
				return;
			}
			// Everyone it saw in the world it leaves goes from its screen too.
			this.leaveRoom(member, true);
			member.spot = spot;
			this.enter(member, world);
		} else {
			member.spot = spot;
		}
		this.refreshSight(member);
		if (member.room && member.lastRoster === '') this.sendRoster(member);
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

	private enter(member: Member, world: number): void {
		let room = this.rooms.get(world);
		if (!room) {
			room = { world, members: new Set() };
			this.rooms.set(world, room);
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
		if (!room) return;
		room.members.delete(member);
		if (room.members.size === 0) this.rooms.delete(room.world);
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
		for (const other of room.members) {
			if (other === member || !other.spot) continue;
			const seeing = member.sees.has(other);
			if (inView(at, other.spot, seeing)) {
				other.peer.send(peerMessage(member, at));
				if (!seeing) {
					member.sees.add(other);
					other.sees.add(member);
					member.peer.send(peerMessage(other, other.spot));
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
		const players = this.rosterFor(member);
		const text = JSON.stringify(players);
		if (text === member.lastRoster) return;
		member.lastRoster = text;
		member.peer.send({ t: 'roster', world: member.room.world, players });
	}
}

function peerMessage(member: Member, spot: Spot): PeerMessage {
	return { t: 'peer', pid: member.pid, name: member.name, ...spot };
}

/** Steps apart on the grid, exactly, for sorting the roster (it shows them rounded). */
function steps(a: GridPos, b: GridPos): number {
	return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
