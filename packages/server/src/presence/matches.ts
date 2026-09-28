import { randomBytes, randomInt } from 'node:crypto';
import {
	MATCH_SIDES,
	applyMatchIntent,
	challengeRefusal,
	matchFight,
	matchFightEvents,
	matchTeam,
	matchView,
	otherSide,
	startMatch,
	worldSeed,
	type AnimalInstance,
	type ClientMessage,
	type InviteEnd,
	type MatchSide,
	type MatchState,
	type MatchTimeout,
	type WireAnimal,
	type WireMatchEvent
} from '@mathgame/engine';
import type { Peer, PresenceHub, Present } from './hub.js';

/**
 * Friendly matches over the presence socket ([[DECISIONS]] § Multiplayer:
 * the server is the authority for what two players share). A match is played
 * here, in the engine's match reducer, with a seed only this server holds;
 * each page is sent its own view of it (`matchView`), which never holds a
 * puzzle's answer, and the events of each step, which don't either.
 *
 * - **The invite.** A page asks another player in its world (`challenge`,
 *   with the team it brings). The server asks the engine's rule
 *   (`challengeRefusal`: within reach, both exploring, both on land) with the
 *   positions both pages last reported, and checks what only it knows:
 *   neither is in a match, neither is asking or being asked, and the
 *   challenger is not asking again too soon after a No (`askAgainMs`). The
 *   invite lasts `inviteMs`, and ends at once, kindly worded to each side,
 *   when either walks out of reach, gets busy, leaves the world or the game,
 *   takes it back or says no. Two players who ask each other at once want the
 *   same thing: the second ask is a Yes.
 * - **The match.** Teams are what each page sends, through `matchTeam`, so
 *   the shape is the engine's to check; the server trusts a page's party, as
 *   it trusts where the page says it stands: a match changes nothing, so a
 *   forged team wins nothing that lasts. Sides are fixed: the challenger is
 *   `a`, and the engine's coin says who starts. Only the side whose turn it
 *   is acts; a refused intent is told to its sender alone.
 * - **The turn clock.** A kid who has not touched the keys on their turn for
 *   `nudgeMs` is asked "Still there?" (`nudge`); any key starts the clock
 *   again (the page sends `here`, at most every so often), so a slow solver
 *   is never hurried. After `idleMs` without a key the match ends, and the
 *   other side wins (`timeout`, `idle`).
 * - **Dropping out.** A page whose socket closes has `awayMs` to come back
 *   (the same player, by who they are, on any socket): the other page is
 *   told, and the match waits for them; then the match ends and the other
 *   side wins (`dropped`). A page that comes back is sent the match at once.
 * - **After the match.** Both pages stay on the result until the kid goes
 *   back to exploring (their `where` says so). "Rematch?" from both starts a
 *   new match between the same two, with a new seed; one who goes back puts
 *   it off, and so does `lingerMs` passing. The one who left skips the
 *   result, so they are let go of at once. A match that ended keeps nobody
 *   busy: only a match going on does (or a finished one a page that came
 *   back is about to put up), so a kid back to exploring can ask and be
 *   asked straight away, and asking (or being asked) lets go of the match
 *   they had finished (#139).
 * - **Seen from outside.** The players near either of the two see the match
 *   beside them in the world: the two animals, the puzzle of whoever's turn
 *   it is, every hit and the end (`show`, through the hub), built from this
 *   server's own state and never from what a page says.
 * - **Stopping** (a deploy): every match and invite ends at once, with no
 *   winner; the pages hear `bye: restart`, say the game is updating, and
 *   offer to play again once they are back.
 *
 * Everything is in this process's memory, like presence. Every exit path —
 * an end, a timeout, a socket that closed, a stop — clears the timers it
 * set and forgets what it no longer needs.
 */

export interface MatchOptions {
	/** How long an invite waits for its answer. */
	inviteMs?: number;
	/** How long a challenger waits to ask the same player again after a No, or no answer. */
	askAgainMs?: number;
	/** How long a challenger waits to ask the same player again after taking an ask back. */
	withdrawnMs?: number;
	/** How long a page that dropped out of a match has to come back. */
	awayMs?: number;
	/** How long a kid may sit on their turn before "Still there?". */
	nudgeMs?: number;
	/** How long a kid may sit on their turn before the match ends. */
	idleMs?: number;
	/** How long a match that ended waits for a rematch. */
	lingerMs?: number;
	/** Match messages a page may send a second, on average (`burst` at once); the rest are dropped. */
	ratePerSecond?: number;
	burst?: number;
	/** A new match's seed: 32 random bits. */
	seed?: () => number;
	/** A new match's id. */
	id?: () => string;
	log?: (line: string) => void;
}

/** The kinds of message a page sends about matches, which `handle` takes. */
export type MatchClientMessage = Extract<
	ClientMessage,
	{ t: 'challenge' | 'withdraw' | 'accept' | 'decline' | 'play' | 'here' | 'rematch' | 'done' }
>;

type Timer = ReturnType<typeof setTimeout>;

/** One player, by who they are (`key`), whichever socket they are on: what matches know of them. */
interface Player {
	readonly key: string;
	/** Their socket now; null while they are away. */
	peer: Peer | null;
	pid: string;
	name: string;
	/** The invite they are asking or being asked, if any. */
	invite: Invite | null;
	/**
	 * Their match, going on or ended: ended, until they go back to exploring,
	 * leave it, or ask or are asked for another. Only one going on makes them busy.
	 */
	match: Match | null;
	/**
	 * The finished match their page was sent as it came back (`resume`) and
	 * has not put up yet: its first `where` can still say exploring. Until it
	 * says `match` (it shows the result), or lets the match go, they are busy.
	 */
	unshown: Match | null;
	tokens: number;
	lastRefill: number;
}

interface Invite {
	readonly from: Player;
	readonly to: Player;
	/** The challenger's team, as `matchTeam` built it. */
	readonly team: AnimalInstance[];
	readonly timer: Timer;
}

interface Match {
	readonly id: string;
	readonly seed: number;
	state: MatchState;
	readonly players: Record<MatchSide, Player>;
	readonly pids: Record<MatchSide, string>;
	readonly names: Record<MatchSide, string>;
	/** A side whose page dropped out: until when it may come back. */
	readonly away: Record<MatchSide, { until: number; timer: Timer } | null>;
	/** The turn clock of the side acting now. */
	clock: Timer[];
	/** Why a side was reported gone, once the match ended `timed-out`. */
	timeout: MatchTimeout | null;
	/** After the end: the team each side would play a rematch with. */
	readonly wishes: Record<MatchSide, AnimalInstance[] | null>;
	/** After the end: when the rematch is off. */
	linger: Timer | null;
}

export class Matches {
	private readonly players = new Map<string, Player>();
	/** Every socket that said hello, and whose it is: kept after the hub forgets it, for `left`. */
	private readonly keyOf = new Map<Peer, string>();
	private readonly matches = new Map<string, Match>();
	/** `from>to` → until when `from` may not ask `to` again. */
	private readonly cooldowns = new Map<string, number>();
	private readonly inviteMs: number;
	private readonly askAgainMs: number;
	private readonly withdrawnMs: number;
	private readonly awayMs: number;
	private readonly nudgeMs: number;
	private readonly idleMs: number;
	private readonly lingerMs: number;
	private readonly ratePerSecond: number;
	private readonly burst: number;
	private readonly newSeed: () => number;
	private readonly newId: () => string;
	private readonly log: (line: string) => void;

	constructor(
		private readonly hub: PresenceHub,
		options: MatchOptions = {}
	) {
		this.inviteMs = options.inviteMs ?? 20_000;
		this.askAgainMs = options.askAgainMs ?? 30_000;
		this.withdrawnMs = options.withdrawnMs ?? 10_000;
		this.awayMs = options.awayMs ?? 30_000;
		this.nudgeMs = options.nudgeMs ?? 90_000;
		this.idleMs = options.idleMs ?? 180_000;
		this.lingerMs = options.lingerMs ?? 120_000;
		this.ratePerSecond = options.ratePerSecond ?? 3;
		this.burst = options.burst ?? 8;
		this.newSeed = options.seed ?? (() => randomInt(0, 2 ** 32));
		this.newId = options.id ?? (() => randomBytes(12).toString('base64url'));
		this.log = options.log ?? (() => {});
	}

	/** Matches going on or waiting for a rematch: for tests and logs. */
	get size(): number {
		return this.matches.size;
	}

	/** The players known here (in a match, an invite, or on a socket): for tests. */
	get known(): number {
		return this.players.size;
	}

	/** A match's state, answer and all: for tests only, never sent. */
	stateOf(id: string): MatchState | null {
		return this.matches.get(id)?.state ?? null;
	}

	/**
	 * A socket said hello as `present`: it is this player's now. A player who
	 * dropped out of a match is back in it; the id of their match, if any,
	 * goes in the `hi`, and `resume` sends it after. An invite of theirs from
	 * another socket ends: this page knows nothing of it.
	 */
	joined(peer: Peer, present: Present): string | null {
		this.keyOf.set(peer, present.key);
		let player = this.players.get(present.key);
		if (!player) {
			player = {
				key: present.key,
				peer,
				pid: present.pid,
				name: present.name,
				invite: null,
				match: null,
				unshown: null,
				tokens: this.burst,
				lastRefill: Date.now()
			};
			this.players.set(present.key, player);
		}
		player.peer = peer;
		player.pid = present.pid;
		player.name = present.name;
		// An invite from another socket: this page knows nothing of it.
		if (player.invite) this.dropInvite(player.invite, player);
		const match = player.match;
		if (!match) return null;
		const side = sideOf(match, player);
		const away = match.away[side];
		if (away) {
			clearTimeout(away.timer);
			match.away[side] = null;
			if (actingSide(match) === side) this.startClock(match);
		}
		return match.id;
	}

	/** After the `hi`: a page back in its match is sent it, and the other page hears it is back. */
	resume(peer: Peer): void {
		const player = this.playerOn(peer);
		const match = player?.match;
		if (!player || !match) return;
		// A finished one goes up on the page: the player is busy with it until it is.
		if (!live(match)) player.unshown = match;
		for (const side of MATCH_SIDES) this.send(match, side, []);
		// The players near the page that came back see the match again, if it goes on.
		this.show(match, []);
	}

	/**
	 * The socket said where it is: an invite may no longer be possible. (A
	 * finished match is never left on a `where`: a page's first `where` can
	 * come before it has even been sent the match. It is left when the page
	 * says so, `done`, by leaving, or by asking or being asked for another,
	 * and it keeps nobody busy meanwhile.)
	 */
	moved(peer: Peer): void {
		const player = this.playerOn(peer);
		if (player?.unshown && this.hub.present(peer)?.spot?.busy === 'match') player.unshown = null;
		if (player?.invite) this.recheck(player.invite, player);
	}

	/** The socket closed, whatever closed it. */
	left(peer: Peer): void {
		const key = this.keyOf.get(peer);
		this.keyOf.delete(peer);
		const player = key === undefined ? undefined : this.players.get(key);
		// A socket another took the place of: the player plays on there.
		if (!player || player.peer !== peer) return;
		player.peer = null;
		if (player.invite) this.dropInvite(player.invite, player);
		const match = player.match;
		if (match) this.goAway(match, sideOf(match, player));
		this.forgetIfDone(player);
	}

	/** A message about matches from a socket that said hello. */
	handle(peer: Peer, message: MatchClientMessage): void {
		const player = this.playerOn(peer);
		const present = this.hub.present(peer);
		if (!player || !present) return;
		if (!this.takeToken(player)) {
			if (message.t === 'challenge') this.tell(player, message.pid, 'wait');
			return;
		}
		switch (message.t) {
			case 'challenge':
				return this.challenge(player, present, message.pid, message.team);
			case 'withdraw':
				if (player.invite?.from === player) {
					this.endInvite(player.invite, { from: 'off', to: 'withdrawn' }, this.withdrawnMs);
				}
				return;
			case 'accept':
				return this.accept(player, message.pid, message.team);
			case 'decline': {
				const invite = player.invite;
				if (invite?.to === player && invite.from.pid === message.pid) {
					this.endInvite(invite, { from: 'no', to: 'off' }, this.askAgainMs);
				}
				return;
			}
			case 'play':
				return this.play(player, message.id, message.intent);
			case 'here': {
				const match = player.match;
				if (match?.id === message.id && actingSide(match) === sideOf(match, player)) {
					this.startClock(match);
				}
				return;
			}
			case 'rematch':
				return this.rematch(player, message.id, message.team);
			case 'done': {
				// Back to exploring from the result: the rematch is off, for this player at least.
				const match = player.match;
				if (match?.id === message.id && match.state.phase.kind === 'ended') {
					this.detach(match, sideOf(match, player));
				}
				return;
			}
		}
	}

	/** This server is stopping: every match and invite ends here, with no winner. */
	stop(): void {
		const count = this.matches.size;
		for (const match of this.matches.values()) this.clearTimers(match);
		for (const player of this.players.values()) {
			if (player.invite) clearTimeout(player.invite.timer);
		}
		this.matches.clear();
		this.players.clear();
		this.keyOf.clear();
		this.cooldowns.clear();
		if (count > 0) this.log(`matches: stopping, ${count} ended`);
	}

	// --- invites --------------------------------------------------------------------

	private challenge(player: Player, me: Present, pid: string, sent: WireAnimal[]): void {
		const target = this.hub.presentByPid(pid);
		const them = target ? this.players.get(target.key) : undefined;
		if (!target || !them || target.key === me.key || target.world !== me.world) {
			return this.tell(player, pid, 'gone');
		}
		// They asked me first: asking them back is a Yes.
		if (player.invite?.to === player && player.invite.from === them) {
			return this.accept(player, pid, sent);
		}
		// Only a match going on (or one a page is about to show) makes anyone busy: one that
		// ended waits only for a rematch.
		if (player.invite || busy(player)) return this.tell(player, pid, 'off');
		const team = matchTeam(sent);
		if (!team.ok) return this.tell(player, pid, 'no-team');
		if (me.world === null || !me.spot || !target.spot) return this.tell(player, pid, 'gone');
		const refusal = challengeRefusal(worldSeed(me.world), me.spot, target.spot);
		if (refusal) return this.tell(player, pid, refusalFor(refusal).from ?? 'off');
		if (them.invite) return this.tell(player, pid, 'taken');
		if (busy(them)) return this.tell(player, pid, 'busy');
		const cooldown = `${player.key}>${them.key}`;
		const until = this.cooldowns.get(cooldown);
		if (until !== undefined && until > Date.now()) return this.tell(player, pid, 'wait');
		this.cooldowns.delete(cooldown);
		this.pruneCooldowns();
		// Both are out exploring (the rule above says so): a match either had finished is behind them.
		this.letGoOfEnded(player);
		this.letGoOfEnded(them);

		const invite: Invite = {
			from: player,
			to: them,
			team: team.team,
			timer: setTimeout(() => {
				if (player.invite === invite) {
					this.endInvite(invite, { from: 'expired', to: 'expired' }, this.askAgainMs);
				}
			}, this.inviteMs)
		};
		invite.timer.unref?.();
		player.invite = invite;
		them.invite = invite;
		player.peer?.send({ t: 'asking', pid: them.pid, ms: this.inviteMs });
		them.peer?.send({ t: 'invite', pid: player.pid, name: player.name, ms: this.inviteMs });
	}

	private accept(player: Player, pid: string, sent: WireAnimal[]): void {
		const invite = player.invite;
		if (!invite || invite.to !== player || invite.from.pid !== pid) {
			return this.tell(player, pid, 'off');
		}
		const team = matchTeam(sent);
		if (!team.ok) return this.endInvite(invite, { from: 'their-team', to: 'no-team' });
		if (!this.recheck(invite)) return;
		this.endInvite(invite, { from: null, to: null });
		this.start(invite.from, invite.team, player, team.team);
	}

	/**
	 * Whether the invite can still turn into a match: both still here, in one
	 * world, within reach, exploring, on land. If not, it ends, each side told
	 * why in its own words: `mover`, when a move of theirs is why, is told
	 * nothing. True while it still can.
	 */
	private recheck(invite: Invite, mover?: Player): boolean {
		const from = invite.from.peer && this.hub.present(invite.from.peer);
		const to = invite.to.peer && this.hub.present(invite.to.peer);
		if (!from || !to) {
			this.endInvite(invite, { from: from ? 'gone' : 'off', to: to ? 'gone' : 'off' });
			return false;
		}
		if (from.world !== to.world || from.world === null || !from.spot || !to.spot) {
			// Somebody went to another world: to the other, they went.
			const said: Said = { from: 'gone', to: 'gone' };
			if (mover === invite.from) said.from = 'off';
			if (mover === invite.to) said.to = 'off';
			this.endInvite(invite, said);
			return false;
		}
		const refusal = challengeRefusal(worldSeed(from.world), from.spot, to.spot);
		if (refusal === null) return true;
		// Out of reach: whoever walked off is told nothing, the other that they walked off.
		const walker = refusal === 'far' && mover === invite.from ? 'from' : null;
		const said = walker ? { from: 'off' as const, to: 'moved' as const } : refusalFor(refusal);
		// A challenger who ended it (walked off, sailed off, got busy) waits as after taking it back.
		this.endInvite(invite, said, said.from === 'off' ? this.withdrawnMs : undefined);
		return false;
	}

	/**
	 * The invite is over: each side is told why (`said.from` to the
	 * challenger, `said.to` to the one asked; null: nothing, a match is
	 * starting), and the challenger waits `cooldownMs` to ask the same player
	 * again, if given.
	 */
	private endInvite(invite: Invite, said: Said, cooldownMs?: number): void {
		clearTimeout(invite.timer);
		const { from, to } = invite;
		if (from.invite === invite) from.invite = null;
		if (to.invite === invite) to.invite = null;
		if (said.from) this.tell(from, to.pid, said.from);
		if (said.to) this.tell(to, from.pid, said.to);
		if (cooldownMs !== undefined) {
			this.cooldowns.set(`${from.key}>${to.key}`, Date.now() + cooldownMs);
		}
		this.forgetIfDone(from);
		this.forgetIfDone(to);
	}

	/**
	 * `player`'s socket went (or another took its place) with an invite open:
	 * the other side hears they went; a challenger waits as after taking it
	 * back, so leaving and coming back is no way round the wait.
	 */
	private dropInvite(invite: Invite, player: Player): void {
		const challenger = invite.from === player;
		this.endInvite(
			invite,
			saidTo(invite, player, 'off', 'gone'),
			challenger ? this.withdrawnMs : undefined
		);
	}

	private tell(player: Player, pid: string, reason: InviteEnd): void {
		player.peer?.send({ t: 'uninvite', pid, reason });
	}

	private pruneCooldowns(): void {
		const now = Date.now();
		for (const [pair, until] of this.cooldowns) if (until <= now) this.cooldowns.delete(pair);
	}

	// --- matches --------------------------------------------------------------------

	private start(a: Player, teamA: AnimalInstance[], b: Player, teamB: AnimalInstance[]): void {
		const seed = this.newSeed();
		const match: Match = {
			id: this.newId(),
			seed,
			state: startMatch({ a: teamA, b: teamB }, seed),
			players: { a, b },
			pids: { a: a.pid, b: b.pid },
			names: { a: a.name, b: b.name },
			away: { a: null, b: null },
			clock: [],
			timeout: null,
			wishes: { a: null, b: null },
			linger: null
		};
		this.matches.set(match.id, match);
		a.match = match;
		b.match = match;
		a.unshown = null;
		b.unshown = null;
		this.startClock(match);
		this.log(`matches: ${match.id} started`);
		for (const side of MATCH_SIDES) this.send(match, side, []);
		this.show(match, []);
	}

	private play(
		player: Player,
		id: string,
		intent: Extract<MatchClientMessage, { t: 'play' }>['intent']
	): void {
		const match = player.match;
		if (!match || match.id !== id || match.state.phase.kind === 'ended') {
			// A page that came back to its finished match and can't put it up (a battle of its
			// own is on) leaves it: the player is let go of it.
			if (match?.id === id && intent.type === 'leave') this.detach(match, sideOf(match, player));
			player.peer?.send({ t: 'rejected', id, reason: 'match-over' });
			return;
		}
		const side = sideOf(match, player);
		const step = applyMatchIntent(match.state, side, intent, match.seed);
		const refused = step.events.find((e) => e.type === 'rejected');
		if (refused?.type === 'rejected') {
			player.peer?.send({ t: 'rejected', id, reason: refused.reason });
			return;
		}
		this.advance(match, step.state, step.events as WireMatchEvent[]);
		// The one who left goes straight back to exploring, with no result and no rematch: free
		// at once, once their page has been sent how it ended. The other page knows from the end.
		if (intent.type === 'leave') this.detach(match, side, false);
	}

	/** The match took a step: both pages see it, and the clock goes to whoever acts now. */
	private advance(match: Match, state: MatchState, events: WireMatchEvent[]): void {
		match.state = state;
		if (state.phase.kind === 'ended') this.ended(match);
		else this.startClock(match);
		for (const side of MATCH_SIDES) this.send(match, side, events);
		this.show(match, events);
	}

	/** The server reports `side` gone: dropped out, or sat on its turn. The other side wins. */
	private timeOut(match: Match, side: MatchSide, why: MatchTimeout): void {
		if (match.state.phase.kind === 'ended') return;
		const step = applyMatchIntent(match.state, side, { type: 'timeout' }, match.seed);
		match.timeout = why;
		this.advance(match, step.state, step.events as WireMatchEvent[]);
	}

	private ended(match: Match): void {
		this.stopClock(match);
		const phase = match.state.phase;
		if (phase.kind === 'ended') this.log(`matches: ${match.id} ended (${phase.reason})`);
		// A side that is away keeps its time to come back: back in time, it is shown how it ended.
		match.linger = setTimeout(() => {
			// The rematch lapsed: each page still on the result hears the other can't now.
			for (const side of MATCH_SIDES) {
				const player = match.players[side];
				const other = otherSide(side);
				if (player.match === match) {
					player.peer?.send({ t: 'rematch-wish', id: match.id, side: other, yes: false });
				}
			}
			for (const side of MATCH_SIDES) this.detach(match, side, false);
		}, this.lingerMs);
		match.linger.unref?.();
	}

	private rematch(player: Player, id: string, sent: WireAnimal[]): void {
		const match = player.match;
		if (!match || match.id !== id || match.state.phase.kind !== 'ended') {
			// Gone (both went back, or it lapsed): say so, so the page's Rematch? is not left waiting.
			player.peer?.send({ t: 'rejected', id, reason: 'match-over' });
			return;
		}
		const side = sideOf(match, player);
		const other = otherSide(side);
		const them = match.players[other];
		const team = matchTeam(sent);
		if (them.match !== match || !them.peer || !team.ok) {
			player.peer?.send({ t: 'rematch-wish', id, side: other, yes: false });
			return;
		}
		match.wishes[side] = team.team;
		const theirs = match.wishes[other];
		if (!theirs) {
			for (const s of MATCH_SIDES) {
				match.players[s].peer?.send({ t: 'rematch-wish', id, side, yes: true });
			}
			return;
		}
		const teams = { [side]: team.team, [other]: theirs } as Record<MatchSide, AnimalInstance[]>;
		this.drop(match);
		this.start(match.players.a, teams.a, match.players.b, teams.b);
	}

	/**
	 * `side` is done with a match that ended (went back to exploring, left it,
	 * asked or was asked for another, dropped out, or the rematch lapsed): the
	 * other page hears the rematch is off (unless `tell` is false: it knows),
	 * and the match goes once nobody is left in it.
	 */
	private detach(match: Match, side: MatchSide, tell = true): void {
		const player = match.players[side];
		const away = match.away[side];
		if (away) clearTimeout(away.timer);
		match.away[side] = null;
		match.wishes[side] = null;
		if (player.unshown === match) player.unshown = null;
		if (player.match === match) {
			player.match = null;
			const other = otherSide(side);
			const them = match.players[other];
			if (tell && them.match === match) {
				them.peer?.send({ t: 'rematch-wish', id: match.id, side, yes: false });
			}
			this.forgetIfDone(player);
		}
		if (MATCH_SIDES.every((s) => match.players[s].match !== match)) this.drop(match);
	}

	/**
	 * `player` is out exploring (asking someone, or asked): a match of theirs
	 * that ended is behind them, and the other page hears its rematch is off.
	 */
	private letGoOfEnded(player: Player): void {
		const match = player.match;
		if (match && !live(match)) this.detach(match, sideOf(match, player));
	}

	/** The match is gone: its timers cleared, nobody in it any more. */
	private drop(match: Match): void {
		this.clearTimers(match);
		this.matches.delete(match.id);
		for (const side of MATCH_SIDES) {
			const player = match.players[side];
			if (player.match === match) player.match = null;
			if (player.unshown === match) player.unshown = null;
			this.forgetIfDone(player);
		}
	}

	/**
	 * `side`'s page dropped out: the other page hears it, and the match waits
	 * `awayMs` for it. Not back in time, a match going on ends (`dropped`), and
	 * one that had ended lets it go (the rematch is off).
	 */
	private goAway(match: Match, side: MatchSide): void {
		const timer = setTimeout(() => {
			match.away[side] = null;
			if (match.state.phase.kind === 'ended') {
				this.detach(match, side);
				return;
			}
			this.timeOut(match, side, 'dropped');
			this.detach(match, side, false);
		}, this.awayMs);
		timer.unref?.();
		match.away[side] = { until: Date.now() + this.awayMs, timer };
		if (actingSide(match) === side) this.stopClock(match);
		this.send(match, otherSide(side), []);
	}

	// --- the turn clock ---------------------------------------------------------------

	/** The acting side's clock starts again: "Still there?" after `nudgeMs`, the end after `idleMs`. */
	private startClock(match: Match): void {
		this.stopClock(match);
		const side = actingSide(match);
		if (side === null || match.away[side]) return;
		const nudge = setTimeout(() => {
			match.players[side].peer?.send({ t: 'nudge', id: match.id });
		}, this.nudgeMs);
		const idle = setTimeout(() => this.timeOut(match, side, 'idle'), this.idleMs);
		nudge.unref?.();
		idle.unref?.();
		match.clock = [nudge, idle];
	}

	private stopClock(match: Match): void {
		for (const timer of match.clock) clearTimeout(timer);
		match.clock = [];
	}

	private clearTimers(match: Match): void {
		this.stopClock(match);
		for (const side of MATCH_SIDES) {
			const away = match.away[side];
			if (away) clearTimeout(away.timer);
			match.away[side] = null;
		}
		if (match.linger) clearTimeout(match.linger);
		match.linger = null;
	}

	// --- sending ----------------------------------------------------------------------

	/** `side`'s view of the match and what just happened, if its page is here. */
	private send(match: Match, side: MatchSide, events: WireMatchEvent[]): void {
		const player = match.players[side];
		if (!player.peer || player.match !== match) return;
		const other = otherSide(side);
		const away = match.away[other];
		player.peer.send({
			t: 'match',
			id: match.id,
			pids: { a: match.pids.a, b: match.pids.b },
			names: { a: match.names.a, b: match.names.b },
			view: matchView(match.state, side),
			events,
			away: away ? { side: other, ms: Math.max(0, away.until - Date.now()) } : null,
			timeout: match.timeout
		});
	}

	/**
	 * The match as the players near its two players see it (`hub.match`), from
	 * this server's own state, never from what a page says: how it stands and
	 * this step's events, with no answer and no word in them (`matchFight`).
	 * A match that ended is shown ending once, and not again.
	 */
	private show(match: Match, events: WireMatchEvent[]): void {
		const seen = matchFightEvents(events);
		const over = match.state.phase.kind === 'ended' && !seen.some((e) => e.type === 'ended');
		// Only the players still in this match: one who went back to exploring has moved on.
		const peerOf = (side: MatchSide) => {
			const player = match.players[side];
			return player.match === match ? player.peer : null;
		};
		this.hub.match(
			{ a: peerOf('a'), b: peerOf('b') },
			{ a: match.pids.a, b: match.pids.b },
			over ? null : matchFight(match.state),
			seen
		);
	}

	// --- players ----------------------------------------------------------------------

	private playerOn(peer: Peer): Player | null {
		const key = this.keyOf.get(peer);
		const player = key === undefined ? undefined : this.players.get(key);
		return player && player.peer === peer ? player : null;
	}

	/** A player with no socket, invite or match is forgotten. */
	private forgetIfDone(player: Player): void {
		if (!player.peer && !player.invite && !player.match) {
			if (this.players.get(player.key) === player) this.players.delete(player.key);
		}
	}

	/**
	 * A match message's token from the player's bucket: `ratePerSecond` come
	 * back each second, up to `burst`. Without one, the message is dropped.
	 */
	private takeToken(player: Player): boolean {
		const now = Date.now();
		player.tokens = Math.min(
			this.burst,
			player.tokens + ((now - player.lastRefill) / 1000) * this.ratePerSecond
		);
		player.lastRefill = now;
		if (player.tokens < 1) return false;
		player.tokens -= 1;
		return true;
	}
}

/** What each side of an invite is told as it ends: the challenger (`from`), the one asked (`to`). */
interface Said {
	from: InviteEnd | null;
	to: InviteEnd | null;
}

/** What each side is told: `mine` to `player`, `theirs` to the other side of the invite. */
function saidTo(invite: Invite, player: Player, mine: InviteEnd, theirs: InviteEnd): Said {
	return invite.from === player ? { from: mine, to: theirs } : { from: theirs, to: mine };
}

function sideOf(match: Match, player: Player): MatchSide {
	return match.players.a === player ? 'a' : 'b';
}

/** A match still going on. */
function live(match: Match | null): match is Match {
	return match !== null && match.state.phase.kind !== 'ended';
}

/**
 * Whether a player is too busy for an invite as far as matches know: in a
 * match going on, or about to put up the finished one they came back to
 * (`unshown`). A match waiting for its rematch makes nobody busy: a page on
 * its result says so itself (`match`), and one back to exploring is free.
 */
function busy(player: Player): boolean {
	return live(player.match) || (player.unshown !== null && player.unshown === player.match);
}

/** The side whose turn it is, or null once the match is over. */
function actingSide(match: Match): MatchSide | null {
	const phase = match.state.phase;
	return phase.kind === 'ended' ? null : phase.side;
}

/**
 * What each side of an invite is told when the rule says no, from the
 * challenger's point of view (`challengeRefusal(seed, challenger, target)`):
 * what the one who caused it did is nothing to tell them (`off`).
 */
function refusalFor(refusal: NonNullable<ReturnType<typeof challengeRefusal>>): Said {
	switch (refusal) {
		case 'busy':
			return { from: 'off', to: 'busy' };
		case 'water':
			return { from: 'off', to: 'moved' };
		case 'far':
		case 'they-water':
			return { from: 'moved', to: 'off' };
		case 'they-busy':
			return { from: 'busy', to: 'off' };
	}
}
