import {
	BEARINGS,
	bearingVector,
	facePrompt,
	isWireCoord,
	leadIndex,
	type AnimalInstance,
	type Authority,
	type Busy,
	type ClientMessage,
	type GameEvent,
	type PeerMessage,
	type ServerMessage,
	type WhereMessage
} from '@mathgame/engine';
import type { GameRenderer } from '../render/renderer';
import type { KeyValueStore } from '../save/storage';
import { account } from '../state/account.svelte';
import { battle } from '../state/battle.svelte';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';
import { hud } from '../state/hud.svelte';
import { pause } from '../state/pause.svelte';
import { presence, type Arrow, type Bar, type Label, type Pop } from '../state/presence.svelte';
import { PresenceConnection, type PresenceStatus } from './connection';
import { guestId } from './identity';
import { ArrivalNotes } from './notes';
import { BattleReport } from './report';

/**
 * Playing together, on the page ([[UI_SPEC]] § Explore mode, "Playing
 * together"; [[PRODUCT]] §4): the glue between the game, the presence
 * socket (`connection.ts`) and what the page shows of the others.
 *
 * - **When.** Present while a game is under way (`welcome` until
 *   `game-left`): never behind the title, never in a throwaway game (`?new`
 *   and friends: [[CHEATSHEET]]), never on a page that is behind the save,
 *   and only with a name to show.
 * - **Where.** Every frame it works out where the player is and what they
 *   are doing (`busy`: a battle, the doctor, the menu, else exploring) and
 *   hands it to the socket, which sends it when it changed.
 * - **Who.** The server's `peer` and `gone` put the players near on screen
 *   and take them off (`render/others.ts`); its roster is the pause menu's
 *   list and the arrows at the edge of the screen; the notes at the top say
 *   who came and who went home (`notes.ts`).
 * - **Go to.** The menu's "Go to Ada" asks the server where Ada is exactly
 *   (`find`), then asks the authority to put the player beside her
 *   (`go-to`), which is where the player's position is decided.
 * - **Out of date.** A server that speaks a newer protocol gets the page
 *   reloaded, once, at a calm moment: exploring, no card or menu open. The
 *   game is saved in the browser first.
 *
 * Nothing here is waited on: without the socket the game plays on, and the
 * list says the others are being looked for.
 */

/** Seconds to wait for the server's answer about where a player is. */
export const FIND_SECONDS = 4;
/**
 * Seconds the players on screen, and the list and arrows, stay after the
 * socket drops, in case it is back at once (a restart); then they go, since
 * where they are is no longer known.
 */
export const HOLD_SECONDS = 5;
/** Seconds after a socket comes back for the server to say again who is near; the rest fade out. */
export const CONFIRM_SECONDS = 3;
/** How many players off screen get an arrow: the nearest. */
export const MAX_ARROWS = 4;
/** How far in from the edges of the screen an arrow sits, in CSS pixels: clear of the corners' panels' edges. */
const ARROW_INSET = { side: 44, top: 44, bottom: 96 };
/** How far towards a player known only roughly to aim: well off screen, the way they are. */
const ROUGH_AIM = 40;
/** The session key that remembers which version a page reloaded for, so it never reloads in a loop. */
export const REFRESHED_KEY = 'animath.refreshedFor';

/**
 * The friendly matches (`match/controller.ts`), as presence talks to them:
 * the server's messages about matches (and `hi` and `bye`, which say whether
 * a match survived a drop), the socket's status, the players near and where
 * they stand, and whether the match screen is up (the page is busy with a
 * match, and nothing of presence shows over it).
 */
export interface MatchHooks {
	receive(message: ServerMessage): void;
	status(status: PresenceStatus): void;
	peer(message: PeerMessage): void;
	gone(pid: string): void;
	/** The others see this player in a match. */
	readonly busy: boolean;
	/** A match's screen or card is up: presence's notes and names keep off it. */
	readonly onScreen: boolean;
}

/** The server's messages about friendly matches, which go to `MatchHooks`. */
const MATCH_KINDS: ReadonlySet<ServerMessage['t']> = new Set([
	'hi',
	'bye',
	'invite',
	'asking',
	'uninvite',
	'match',
	'rejected',
	'nudge',
	'rematch-wish'
]);

/** What the controller needs of the renderer: the others and their battles, and where things are on the canvas. */
export type PresenceRenderer = Pick<
	GameRenderer,
	'others' | 'fights' | 'toScreen' | 'groundToScreen' | 'showingWorld' | 'screenSize'
>;

export interface PresenceOptions {
	authority: Authority;
	renderer: PresenceRenderer;
	/** localStorage: where the guest id is kept. */
	store: KeyValueStore | null;
	/** sessionStorage: which version this page last reloaded for. */
	session: KeyValueStore | null;
	/** A throwaway game (`?new` and friends): never seen by anyone. */
	throwaway: boolean;
	/** The page is behind the save and takes no play: it is not present either. */
	behind: () => boolean;
	/** Save now, before a reload. */
	flush: () => void;
	reload: () => void;
	/** Seconds, for timers that count real time (the notes, waiting for an answer). */
	clock?: () => number;
	/** The friendly matches, which ride on the same socket. */
	match?: MatchHooks;
	/** A socket of the test's own. */
	connection?: (
		onMessage: (m: ServerMessage) => void,
		onStatus: (s: PresenceStatus) => void
	) => PresenceConnection;
}

export class PresenceController {
	private readonly connection: PresenceConnection;
	private readonly notes = new ArrivalNotes();
	/** The player's own battle with a wild animal, as the others near them see it (`report.ts`). */
	private readonly report = new BattleReport();
	private readonly clock: () => number;
	private underWay = false;
	/** The player's name and world, as the game says them: `welcome`, then `name-chosen` and `travelled`. */
	private who: { name: string | null; world: number | null } = { name: null, world: null };
	/** A go-to waiting for the server to say where they are. */
	private finding: { pid: string; name: string; since: number } | null = null;
	/** A go-to the authority is placing: whom it is to, for the line after it. */
	private placing: string | null = null;
	/** Since when the socket has not been on (seconds), or null while it is. */
	private offSince: number | null = null;
	/** The players on screen the server has yet to confirm, after the socket came back, and until when. */
	private unconfirmed = new Set<string>();
	private confirmBy: number | null = null;
	/** The server's newer version, when the page is out of date. */
	private newerVersion: number | null = null;

	constructor(private readonly options: PresenceOptions) {
		this.clock = options.clock ?? (() => performance.now() / 1000);
		const make =
			options.connection ?? ((onMessage, onStatus) => new PresenceConnection(onMessage, onStatus));
		this.connection = make(
			(m) => this.receive(m),
			(s) => this.statusChanged(s)
		);
	}

	handle(event: GameEvent): void {
		this.report.handle(event);
		switch (event.type) {
			case 'welcome':
				// A game under way: nobody from before is on screen.
				this.underWay = true;
				this.who = { name: event.name, world: event.world };
				this.arrive();
				this.connect();
				break;
			case 'name-chosen':
				// A game saved before names has one now: the others can see the player.
				if (event.playerId !== game.playerId) break;
				this.who = { ...this.who, name: event.name };
				this.connect();
				break;
			case 'travelled':
				// Another world: the next `where` names it, and the server moves the socket there.
				if (event.playerId !== game.playerId) break;
				this.who = { ...this.who, world: event.world };
				this.arrive();
				break;
			case 'game-left':
				this.underWay = false;
				this.finding = null;
				this.connection.stop();
				this.options.renderer.others.clear();
				this.options.renderer.fights.clear();
				presence.reset();
				break;
			case 'player-placed':
				if (event.playerId !== game.playerId) break;
				// The player is the one who went in a poof; the friend they came to was there already.
				this.options.renderer.others.hush();
				if (this.placing !== null) hud.presence('nextTo', this.placing);
				this.placing = null;
				break;
			case 'go-to-refused':
				if (this.placing !== null) hud.presence('noRoom', this.placing);
				this.placing = null;
				break;
		}
	}

	/**
	 * The player is somewhere new (a game begun, another world): nobody from
	 * the last place is on screen or on the list, and whoever is here was here
	 * first, so they fade in without a poof.
	 */
	private arrive(): void {
		this.notes.newWorld();
		this.finding = null;
		presence.roster = [];
		this.options.renderer.others.clear();
		this.options.renderer.fights.clear();
		this.options.renderer.others.hush();
	}

	/** Once a frame while the page runs. */
	update(): void {
		if (!this.underWay) return;
		const now = this.clock();
		if (this.options.behind()) {
			// Behind the save: this page takes no play until it reloads, and is nobody's friend meanwhile.
			if (this.connection.status !== 'off') this.connection.stop();
			return;
		}
		const where = this.whereNow();
		if (where) this.connection.where(where);
		// The player's own battle, to the others near them: after where they are, which says they are in it.
		const report = this.report.take(where?.busy ?? null, this.connection.status === 'on');
		if (report) this.connection.send(report);
		if (this.connection.status === 'outdated' && this.calm()) this.reloadOnce();
		if (this.finding && now - this.finding.since > FIND_SECONDS) {
			hud.presence('cantFind', this.finding.name);
			this.finding = null;
		}
		if (this.confirmBy !== null && now >= this.confirmBy) {
			for (const pid of this.unconfirmed) this.options.renderer.others.gone(pid);
			this.unconfirmed.clear();
			this.confirmBy = null;
		}
		if (this.offSince !== null && now - this.offSince > HOLD_SECONDS) {
			// Gone a while: where the others are is no longer known, on screen or off it.
			for (const pid of this.options.renderer.others.pids()) this.options.renderer.others.gone(pid);
			if (presence.roster.length) presence.roster = [];
		}
		const note = this.notes.tick(now, this.exploreOnScreen());
		if (note !== presence.note) presence.note = note;
	}

	/**
	 * After the world is drawn: the names over the players on screen, and
	 * arrows at the edge for the nearest off it.
	 */
	overlay(): void {
		const renderer = this.options.renderer;
		if (!this.underWay || !renderer.showingWorld) {
			if (presence.labels.length) presence.labels = [];
			if (presence.arrows.length) presence.arrows = [];
			if (presence.bars.length) presence.bars = [];
			if (presence.pops.length) presence.pops = [];
			return;
		}
		if (presence.compass.length === 0) presence.compass = compassOf(renderer);
		const marks = renderer.fights.marks();
		const labels: Label[] = [];
		for (const head of renderer.others.heads()) {
			const p = renderer.toScreen(head.at);
			if (!p.visible || head.opacity <= 0) continue;
			const thought = marks.thoughts.get(head.pid);
			labels.push({
				pid: head.pid,
				name: head.name,
				busy: head.busy,
				x: Math.round(p.x),
				y: Math.round(p.y),
				opacity: Math.round(head.opacity * 20) / 20,
				// The puzzle they are thinking about, written out here by the engine's own formatter; the
				// bubble leans away from their battle, off its animals' names.
				thought: thought
					? {
							sum: thought.puzzle ? facePrompt(thought.puzzle) : null,
							mood: thought.mood,
							beat: thought.beat,
							lean: p.x >= renderer.toScreen(thought.scene).x ? 1 : -1
						}
					: null
			});
		}
		const bars: Bar[] = [];
		for (const bar of marks.bars) {
			const p = renderer.toScreen(bar.at);
			if (!p.visible) continue;
			// Where it stands still: the labels are laid out from there (`Others.svelte`).
			const rest = renderer.toScreen(bar.rest);
			bars.push({
				key: bar.key,
				species: bar.animal.species,
				hp: bar.animal.hp,
				maxHp: bar.maxHp,
				x: Math.round(p.x),
				y: Math.round(p.y),
				rx: Math.round(rest.x),
				ry: Math.round(rest.y),
				opacity: Math.round(bar.opacity * 20) / 20
			});
		}
		const pops: Pop[] = [];
		for (const pop of marks.pops) {
			const p = renderer.toScreen(pop.at);
			if (!p.visible) continue;
			pops.push({
				id: pop.id,
				key: pop.key,
				damage: pop.damage,
				level: pop.level,
				x: Math.round(p.x),
				y: Math.round(p.y)
			});
		}
		if (!sameList(bars, presence.bars)) presence.bars = bars;
		if (!sameList(pops, presence.pops)) presence.pops = pops;
		const onScreen = new Set(labels.map((l) => l.pid));
		const arrows: Arrow[] = [];
		const { w, h } = renderer.screenSize();
		const me = renderer.groundToScreen(game.pos.x, game.pos.y);
		for (const entry of presence.roster) {
			if (arrows.length >= MAX_ARROWS) break;
			if (onScreen.has(entry.pid)) continue;
			// Where they are exactly, when they are drawn (near, but off this screen); else roughly.
			const tile = renderer.others.tileOf(entry.pid);
			const v = bearingVector(entry.bearing);
			const aim = tile ?? { x: game.pos.x + v.x * ROUGH_AIM, y: game.pos.y + v.y * ROUGH_AIM };
			const there = renderer.groundToScreen(aim.x, aim.y);
			const spot = edgeSpot(me, there, w, h);
			if (spot) arrows.push({ pid: entry.pid, name: entry.name, ...spot });
		}
		if (!sameList(labels, presence.labels)) presence.labels = labels;
		if (!sameList(arrows, presence.arrows)) presence.arrows = arrows;
	}

	/** The pause menu's "Go to <name>": ask the server where they are, then go. */
	goTo(pid: string): void {
		const name = presence.roster.find((e) => e.pid === pid)?.name ?? '';
		if (!this.connection.find(pid)) {
			hud.presence('cantFind', name);
			return;
		}
		this.finding = { pid, name, since: this.clock() };
	}

	/** A message about a friendly match, sent now (where the page is first). False with no socket on. */
	send(message: ClientMessage): boolean {
		return this.underWay && !this.options.behind() && this.connection.send(message);
	}

	/** The window is looked at or the network is back: a socket that waits tries again now. */
	wake(): void {
		if (this.underWay && !this.options.behind()) this.connection.wake();
	}

	/** Who this is, where, for tests. */
	get status(): PresenceStatus {
		return this.connection.status;
	}

	// --- the socket ---------------------------------------------------------------

	private connect(): void {
		const { name, world } = this.who;
		if (this.options.throwaway || name === null || world === null || this.options.behind()) {
			this.connection.stop();
			return;
		}
		this.connection.start(guestId(this.options.store), name);
	}

	private receive(m: ServerMessage): void {
		const others = this.options.renderer.others;
		const now = this.clock();
		if (MATCH_KINDS.has(m.t)) this.options.match?.receive(m);
		switch (m.t) {
			case 'hi':
				// Back after a drop, or here for the first time: whoever is still on screen
				// must be said again, and the next roster is who is here, not who came.
				this.notes.reconnected(now);
				others.hush();
				this.unconfirmed = new Set(others.pids());
				this.confirmBy = this.unconfirmed.size > 0 ? now + CONFIRM_SECONDS : null;
				// A battle going on is told to this server anew: it knows nothing of it.
				this.report.again();
				break;
			case 'fight':
				// Someone near is in a battle: it is drawn beside them. Never the player's own.
				if (m.pid === this.connection.pid || m.vs === this.connection.pid) break;
				this.options.renderer.fights.show(m);
				break;
			case 'peer':
				// Never the player themselves: nobody is drawn twice, whatever a server says.
				if (m.pid === this.connection.pid) break;
				this.unconfirmed.delete(m.pid);
				others.seen(m);
				this.options.match?.peer(m);
				break;
			case 'gone':
				others.gone(m.pid);
				this.options.match?.gone(m.pid);
				break;
			case 'roster': {
				if (m.world !== this.who.world) break;
				const players = m.players.filter((p) => p.pid !== this.connection.pid);
				presence.roster = players;
				this.notes.roster(
					players.map((p) => p.name),
					now
				);
				break;
			}
			case 'found': {
				if (this.finding?.pid !== m.pid) break;
				const name = this.finding.name;
				this.finding = null;
				// Only while exploring, as the menu that asked was: a battle that started
				// meanwhile keeps the player where they are, and so does a take-off.
				if (!this.exploreOnScreen() || game.flying) break;
				// The authority answers at once (`player-placed` or `go-to-refused`, in `handle`).
				this.placing = name;
				this.options.authority.dispatch({ type: 'go-to', near: { x: m.x, y: m.y } });
				this.placing = null;
				break;
			}
			case 'lost':
				if (this.finding?.pid !== m.pid) break;
				hud.presence('lost', this.finding.name);
				this.finding = null;
				break;
			case 'refresh':
				this.newerVersion = m.v;
				break;
			case 'bye':
				if (m.reason === 'replaced') this.notes.elsewhere(now);
				break;
		}
	}

	private statusChanged(status: PresenceStatus): void {
		presence.status = status;
		this.options.match?.status(status);
		if (status === 'on') {
			this.offSince = null;
			return;
		}
		this.offSince ??= this.clock();
		if (status === 'elsewhere' || status === 'off') {
			// Nobody is known here any more: another window has them, or the game left.
			for (const pid of this.options.renderer.others.pids()) this.options.renderer.others.gone(pid);
			presence.roster = [];
		}
	}

	// --- the page -------------------------------------------------------------------

	/** Where the player is and what they are doing, for the server; null when that can't be said. */
	private whereNow(): WhereMessage | null {
		const world = this.who.world;
		if (world === null || (game.mode !== 'explore' && game.mode !== 'battle')) return null;
		if (!isWireCoord(game.pos.x) || !isWireCoord(game.pos.y)) return null;
		return {
			t: 'where',
			world,
			x: game.pos.x,
			y: game.pos.y,
			facing: game.facing,
			lead: following(game.party, game.realm === 'water'),
			boat: game.items.includes('boat'),
			busy: this.busyNow()
		};
	}

	/**
	 * What the player is busy with, as the others see it: a friendly match's
	 * screen or result is a match; its other cards (asking, the update card
	 * over the battle's screen) are exploring, since the player can still be
	 * asked, and ask, from them; else the page's own screens (`busyNow`).
	 */
	private busyNow(): Busy {
		const match = this.options.match;
		if (match?.busy) return 'match';
		if (match?.onScreen) return 'explore';
		return busyNow();
	}

	/** Exploring with nothing over it: the explore screen is up. */
	private exploreOnScreen(): boolean {
		return (
			game.mode === 'explore' &&
			!battle.active &&
			!doctor.active &&
			!pause.open &&
			!this.options.match?.onScreen
		);
	}

	/** A calm moment to reload: exploring, nothing open, feet on the ground. */
	private calm(): boolean {
		return this.exploreOnScreen() && !game.flying;
	}

	/** Reload for the newer version, once per version: a page that comes back still old stays as it is. */
	private reloadOnce(): void {
		const version = String(this.newerVersion ?? 'newer');
		const session = this.options.session;
		// Without a place to remember it, a reload could come back to reload again, and again:
		// such a page stays as it is, alone, until the kid opens it anew.
		if (!session || session.get(REFRESHED_KEY) === version) return;
		if (!session.set(REFRESHED_KEY, version)) return;
		this.options.flush();
		this.underWay = false;
		this.options.reload();
	}
}

/**
 * What the player is busy with, as the others see it. Up in the air it is
 * the glider (`flight`): the tiles sent meanwhile are flown over, so the
 * others draw them gliding rather than walking on the water or through trees.
 */
function busyNow(): Busy {
	if (battle.active) return 'battle';
	if (doctor.active) return 'doctor';
	// An account card (logging in, the hourly card) is a break too: nobody asks for a match meanwhile.
	if (pause.open || account.card !== null || account.prompt) return 'menu';
	if (game.flying) return 'flight';
	return 'explore';
}

/**
 * The species following the player, as their screen shows it
 * (`explore/controller.ts`): on land the lead; out on the water the first
 * that swims, or with none the lead on land, riding in the boat.
 */
export function following(party: readonly AnimalInstance[], onWater: boolean): string | null {
	const onLand = party[leadIndex(party, 'land')]?.speciesId ?? null;
	if (!onWater) return onLand;
	return party[leadIndex(party, 'water')]?.speciesId ?? onLand;
}

/**
 * Where an arrow for something at `there` goes: on the rectangle a little
 * inside the screen's edges, on the line from the player (`me`) to it, and
 * the way it points (radians clockwise from up). Null when it is on the
 * player's own spot.
 */
export function edgeSpot(
	me: { x: number; y: number },
	there: { x: number; y: number },
	w: number,
	h: number
): { x: number; y: number; angle: number } | null {
	const dx = there.x - me.x;
	const dy = there.y - me.y;
	const length = Math.hypot(dx, dy);
	if (length < 1e-6) return null;
	const [ux, uy] = [dx / length, dy / length];
	const left = ARROW_INSET.side;
	const right = Math.max(left, w - ARROW_INSET.side);
	const top = ARROW_INSET.top;
	const bottom = Math.max(top, h - ARROW_INSET.bottom);
	const cx = Math.min(right, Math.max(left, me.x));
	const cy = Math.min(bottom, Math.max(top, me.y));
	const tx = ux > 0 ? (right - cx) / ux : ux < 0 ? (left - cx) / ux : Number.POSITIVE_INFINITY;
	const ty = uy > 0 ? (bottom - cy) / uy : uy < 0 ? (top - cy) / uy : Number.POSITIVE_INFINITY;
	const t = Math.min(tx, ty);
	return {
		x: Math.round(cx + ux * t),
		y: Math.round(cy + uy * t),
		angle: Math.round(Math.atan2(ux, -uy) * 100) / 100
	};
}

/**
 * Which way each roster bearing points on the screen, radians clockwise
 * from up: the ground a few tiles that way from the origin, as the camera
 * draws it. The camera never turns, so this never changes.
 */
function compassOf(renderer: PresenceRenderer): number[] {
	const origin = renderer.groundToScreen(0, 0);
	return Array.from({ length: BEARINGS }, (_, bearing) => {
		const v = bearingVector(bearing);
		const p = renderer.groundToScreen(v.x * 10, v.y * 10);
		return Math.round(Math.atan2(p.x - origin.x, -(p.y - origin.y)) * 100) / 100;
	});
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
	return a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}
