import {
	CHALLENGE_REACH,
	canSendIn,
	challengeRefusal,
	getAnimal,
	matchTeam,
	otherSide,
	tileAtWorld,
	tilesApart,
	type AnimalInstance,
	type ClientMessage,
	type GameEvent,
	type InviteEnd,
	type MatchMessage,
	type MatchSide,
	type PeerMessage,
	type PlayIntent,
	type ServerMessage,
	type WireAnimal,
	type WireMatchEvent
} from '@mathgame/engine';
import { levelPitch } from '../audio/cues';
import { sfx } from '../audio/sfx.svelte';
import { ENTER_SECONDS, IRIS_CLOSE_SECONDS, IRIS_OPEN_SECONDS } from '../battle/controller';
import {
	MATCH_MOVES,
	actionCount,
	firstPickable,
	listKey,
	menuKey,
	pickedMenu
} from '../battle/menu';
import { answerKey } from '../input/answer';
import { isShortcut, keyName } from '../input/keyboard';
import { isMashKey, PickGuard } from '../input/pick-guard';
import { tappedOption } from '../input/press';
import { line, type Line } from '../lines';
import { motion } from '../motion';
import type { PresenceStatus } from '../presence/connection';
import type { MatchHooks } from '../presence/controller';
import { BattleScene, type BattleSide } from '../render/battle-scene';
import type { GameRenderer } from '../render/renderer';
import { account } from '../state/account.svelte';
import { battle } from '../state/battle.svelte';
import { doctor } from '../state/doctor.svelte';
import { game } from '../state/game.svelte';
import { hud, type MatchLine } from '../state/hud.svelte';
import { match, type ButtonRefusal } from '../state/match.svelte';
import { pause } from '../state/pause.svelte';
import { title } from '../state/title.svelte';
import { travel } from '../state/travel.svelte';

/**
 * Friendly matches on the page ([[UI_SPEC]] § Friendly matches; [[PRODUCT]]
 * §4): the Challenge button, the invite, and the match, which the server
 * plays (`packages/server/src/presence/matches.ts`) and this page shows.
 *
 * - **Who can be asked.** Every frame, the nearest player within reach
 *   (`CHALLENGE_REACH`, from the positions presence hears) gets the button,
 *   lit or greyed with why: the engine's rule (`challengeRefusal`), this
 *   player's own team (`matchTeam`), or a No a moment ago.
 * - **The invite.** Asking waits for the answer (walking waits too); being
 *   asked puts a card over the world, and walking goes on (walking off, or
 *   meeting a wild animal, is a No the server hears by itself). Yes waits
 *   the quiet moment every choice waits (`PickGuard`), so a mash never says
 *   yes. However an invite ends, the message line says why, in the kid's
 *   words.
 * - **The match.** It is drawn on the battle's screen (`battle`, with
 *   `battle.vs`): the scene, the status boxes, the attacks and the puzzle.
 *   The server's views arrive with the events that led to them, and are
 *   played back one beat at a time, as a wild battle's are, before the view
 *   itself is shown. Nothing here decides anything: every choice is sent,
 *   and only what comes back changes the screen. While the other player
 *   thinks, their puzzle shows without its answer. The result, the rematch
 *   and the match's notes (dropped out, "Still there?", the connection) are
 *   `match`'s. The player's own game is never touched, but for the puzzles
 *   they solved: each batch of events goes once to `count`, which adds this
 *   player's right answers (`countSolved`); no intent reaches the authority,
 *   so the save is otherwise exactly as it was.
 * - **Leaving.** Always two deliberate presses, each with the line saying
 *   what it does: the Leave move, then Go!; or Escape (the other's turn
 *   card's button is Escape too), then Leave on the question it opens,
 *   where Stay is lit. A kid who presses Escape for the menu is asked, and
 *   stays with another Escape or an Enter.
 * - **Dropped and updated.** A drop keeps the match on screen while the
 *   socket comes back; the server says in its `hi` whether the match is
 *   still on. A server that stops for a new version ends it (`bye:
 *   restart`): the card says so, and Play again asks the same friend once
 *   both are back, one tap each. A server that stopped without a word (a
 *   crash) is known by its `hi`'s `boot`, another than the one the match
 *   began on: the same card, saying the game restarted, since nobody left.
 * - **Back to exploring is final** (#146). The kid's Back on a result
 *   (`goBack`) goes with a `done`, which a socket that is away never
 *   carries, and one that dies as it is sent can lose. So the page keeps
 *   the match it went back from (`wentBack`): it never puts that match up
 *   again, whatever the server still sends of it, and it says `done` again
 *   when a `hi` says the server still has the kid in it. Only the kid's own
 *   Back counts: a result this page let go of because another window took
 *   over follows the kid back to it.
 */

/** Seconds past an invite's time the page waits for the server to say it ended, before letting go. */
const INVITE_GRACE_SECONDS = 3;
/** Seconds a Yes waits for its match before the page lets go. */
const START_SECONDS = 8;
/** Seconds a choice waits for the server's answer before the screen shows the view it has again. */
const ANSWER_SECONDS = 8;
/** The least seconds between two "the kid is at the keys" messages on their turn. */
const HERE_SECONDS = 10;
/** Seconds the button waits after a No or no answer: the server's own wait. */
const ASK_AGAIN_SECONDS = 30;

/** One beat: change something and maybe say a line, then hold for `hold` seconds. */
interface Beat {
	run: () => Line | undefined;
	hold: number;
}

export interface MatchDeps {
	/** Send a message about matches on the presence socket (where the page is goes first). */
	send(message: ClientMessage): boolean;
	renderer: Pick<GameRenderer, 'setBattle' | 'playerScreenPoint'>;
	/**
	 * Close the pause menu and put the hourly account card aside: a match
	 * picked up after a reload takes the screen from them.
	 */
	stepAside?(): void;
	/**
	 * Count this player's right answers in a batch of match events: the one
	 * thing a match changes in the game, the puzzles solved
	 * (`LocalAuthority.countMatchAnswers`). Each batch once.
	 */
	count?(events: readonly WireMatchEvent[], side: MatchSide): void;
	/** Seconds, for the invite's clock and the waits (real time, not frame time). */
	clock?: () => number;
	/** The battle's scene, or a stand-in in a test. */
	scene?: () => BattleScene;
}

export class MatchController implements MatchHooks {
	/** The players near, as presence last heard them: who the button can ask. */
	private readonly peers = new Map<string, PeerMessage>();
	/** How the presence socket is doing. */
	private socket: PresenceStatus = 'off';
	/** When the invite on screen runs out, clock seconds. */
	private deadline = 0;
	/** When this page said yes, clock seconds. */
	private since = 0;
	/** Who the button waits for, and until when (clock seconds): after a No, no answer, or "ask again soon". */
	private readonly waits = new Map<string, number>();
	private readonly guard = new PickGuard();
	private readonly clock: () => number;
	/** The server's latest message about the match on screen; the screen lags it by its beats. */
	private latest: MatchMessage | null = null;
	/** The phase the screen showed last, for the next events: a switch after a knock-out calls nobody back. */
	private shownPhase: MatchMessage['view']['phase']['kind'] | null = null;
	private beats: Beat[] = [];
	private wait = 0;
	private enterIn = 0;
	private scene: BattleScene | null = null;
	private hits = 0;
	/** When a choice went and has had no answer yet, clock seconds. */
	private sentAt: number | null = null;
	/** When "at the keys" last went, clock seconds. */
	private hereAt = Number.NEGATIVE_INFINITY;
	/** When the other player's time to come back runs out, clock seconds. */
	private awayUntil: number | null = null;
	/** The run of the server this socket said hi to last (`hi.boot`), and the one the match on screen began on. */
	private boot: string | null = null;
	private matchBoot: string | null = null;
	/**
	 * The match whose result the kid went back to exploring from, while the
	 * server may still have them in it: its `done` may not have got there.
	 * Never put up again; forgotten once a `hi` names another match, or none.
	 */
	private wentBack: string | null = null;

	constructor(private readonly deps: MatchDeps) {
		this.clock = deps.clock ?? (() => performance.now() / 1000);
	}

	// --- what presence asks ---------------------------------------------------------

	/** Others see this player in a match: the match's screen or its result. */
	get busy(): boolean {
		return match.stage === 'playing' || match.stage === 'over';
	}

	/** Matches take the keys and the screen: asking, starting, the match, its result, the update card. */
	get onScreen(): boolean {
		return match.stage !== 'none' && match.stage !== 'invited';
	}

	receive(m: ServerMessage): void {
		switch (m.t) {
			case 'hi':
				return this.hello(m.match, m.boot ?? null);
			case 'bye':
				if (m.reason === 'restart') this.restarted(false);
				return;
			case 'invite':
				return this.invited(m.pid, m.name, m.ms);
			case 'asking':
				if (match.stage === 'asking' && match.other?.pid === m.pid) {
					this.deadline = this.clock() + m.ms / 1000;
					match.total = m.ms / 1000;
				}
				return;
			case 'uninvite':
				return this.uninvited(m.pid, m.reason);
			case 'match':
				return this.matchMessage(m);
			case 'rejected':
				if (m.id !== match.id) return;
				if (match.stage === 'over') {
					// A Rematch? the server can no longer take: the match is gone there.
					match.rematch = { mine: false, theirs: false };
					match.option = 1;
					return;
				}
				// Something changed under the choice (or it came too fast): show the view there is.
				console.warn(`match intent rejected: ${m.reason}`);
				this.sentAt = null;
				if (this.beats.length === 0) this.settle();
				return;
			case 'nudge':
				if (m.id === match.id && match.stage === 'playing') match.nudged = true;
				return;
			case 'rematch-wish': {
				if (m.id !== match.id || match.stage !== 'over') return;
				const mine = m.side === match.you;
				match.rematch = mine
					? { ...match.rematch, mine: m.yes }
					: { ...match.rematch, theirs: m.yes };
				if (!mine && m.yes) sfx.play('lead');
				// The rematch is off: the highlight goes to the one button that still does something.
				if (!mine && !m.yes) match.option = 1;
				return;
			}
		}
	}

	status(status: PresenceStatus): void {
		this.socket = status;
		if (status === 'on') {
			match.offline = false;
			return;
		}
		// Nobody near is known any more; the socket's next hi brings them back.
		this.peers.clear();
		if (
			status === 'elsewhere' ||
			status === 'off' ||
			status === 'refused' ||
			status === 'outdated'
		) {
			// Another window plays on, or the game is gone: nothing of a match stays here.
			if (match.stage === 'playing' || match.stage === 'over') this.finish();
			else if (match.stage !== 'none') this.letGo(null);
			return;
		}
		// The socket is coming back: a match waits for it; an invite is over (the server says so to the other).
		if (match.stage === 'playing' || match.stage === 'over') match.offline = true;
		else if (match.stage === 'asking' || match.stage === 'invited' || match.stage === 'starting') {
			this.letGo(match.other ? 'lost' : null);
		}
		if (match.stage === 'updating') match.friendBack = false;
	}

	peer(message: PeerMessage): void {
		this.peers.set(message.pid, message);
		if (match.stage === 'updating' && message.pid === match.other?.pid) match.friendBack = true;
	}

	gone(pid: string): void {
		this.peers.delete(pid);
		if (match.stage === 'updating' && pid === match.other?.pid) match.friendBack = false;
	}

	// --- the game's events ---------------------------------------------------------------

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
			case 'game-left':
				// Another game, or none: nothing of a match or an invite carries over.
				if (match.stage === 'playing' || match.stage === 'over') this.finish();
				else match.reset();
				this.waits.clear();
				break;
		}
	}

	// --- each frame ---------------------------------------------------------------------

	update(dt: number): void {
		const now = this.clock();
		this.guard.tick(dt);
		const ready = this.guard.ready;
		if (match.ready !== ready) match.ready = ready;
		switch (match.stage) {
			case 'asking':
			case 'invited': {
				match.left = Math.max(0, this.deadline - now);
				// The server ends every invite; if its word never comes, the page lets go.
				if (now > this.deadline + INVITE_GRACE_SECONDS) {
					this.letGo(match.stage === 'asking' ? 'expired' : null);
				}
				break;
			}
			case 'starting':
				if (now - this.since > START_SECONDS) this.letGo('lost');
				break;
			case 'updating':
				// The friend's ask to play again runs out like any invite.
				if (match.friendAsked && now > this.deadline) match.friendAsked = false;
				break;
			case 'playing':
			case 'over':
				this.play(dt, now);
				break;
		}
		this.updateButton(now);
	}

	/** The fight's frame: the iris, the beats, the waits. */
	private play(dt: number, now: number): void {
		const transition = battle.transition;
		if (battle.entering) {
			this.enterIn -= dt;
			if (transition) {
				transition.p = Math.min(1, (ENTER_SECONDS - this.enterIn) / IRIS_CLOSE_SECONDS);
			}
			if (this.enterIn > 0) return;
			battle.entering = false;
			this.deps.renderer.setBattle(this.scene);
			const at = this.scene!.screenPoint('opponent');
			battle.transition = { kind: transition?.kind ?? 'iris', closing: false, p: 0, ...at };
		} else if (transition) {
			transition.p += dt / IRIS_OPEN_SECONDS;
			if (transition.p >= 1) battle.transition = null;
		}
		this.wait -= dt;
		while (this.wait <= 0 && this.beats.length > 0) {
			const beat = this.beats.shift()!;
			const said = beat.run();
			if (said !== undefined) battle.line = said;
			this.wait = beat.hold;
		}
		if (this.wait <= 0 && this.beats.length === 0 && battle.screen === 'busy') {
			// Every beat played: the view, unless a choice is still out.
			if (this.sentAt === null) this.settle();
			else if (now - this.sentAt > ANSWER_SECONDS) {
				this.sentAt = null;
				this.settle();
			}
		}
		if (this.awayUntil !== null) match.away = Math.max(0, Math.ceil(this.awayUntil - now));
		const pick = battle.active && this.guard.ready;
		if (battle.ready !== pick) battle.ready = pick;
	}

	/** Who the button asks, and whether it can: the nearest player within reach. */
	private updateButton(now: number): void {
		const exploring = match.stage === 'none' && this.exploring() && this.socket === 'on';
		let near: PeerMessage | null = null;
		if (exploring) {
			// The nearest; between two as near, by name, then by id, so it never flickers.
			const reach = [...this.peers.values()]
				.map((peer) => ({ peer, apart: tilesApart(game.pos, peer) }))
				.filter((p) => p.apart <= CHALLENGE_REACH)
				.sort(
					(p, q) =>
						p.apart - q.apart ||
						(p.peer.name < q.peer.name ? -1 : p.peer.name > q.peer.name ? 1 : 0) ||
						(p.peer.pid < q.peer.pid ? -1 : 1)
				);
			near = reach[0]?.peer ?? null;
		}
		if (!near) {
			if (match.button !== null) match.button = null;
			return;
		}
		const refusal = this.buttonRefusal(near, now);
		const was = match.button;
		if (was?.pid !== near.pid || was.name !== near.name || was.refusal !== refusal) {
			match.button = { pid: near.pid, name: near.name, refusal };
		}
	}

	private buttonRefusal(peer: PeerMessage, now: number): ButtonRefusal | null {
		const rule = challengeRefusal(
			game.seed,
			{ x: game.pos.x, y: game.pos.y, busy: 'explore' },
			{ x: peer.x, y: peer.y, busy: peer.busy }
		);
		if (rule === 'water' || rule === 'they-busy' || rule === 'they-water') return rule;
		if (!matchTeam(game.party).ok) return 'no-team';
		if ((this.waits.get(peer.pid) ?? 0) > now) return 'wait';
		return null;
	}

	// --- keys -----------------------------------------------------------------------------

	/**
	 * A key on the explore screen, before walking hears it: the invite's Yes
	 * (Enter, Space) and No (Escape) while it is up, and C for the button.
	 * True when it was the match's, so nothing else acts on it.
	 */
	exploreKey(e: KeyboardEvent): boolean {
		if (isShortcut(e)) return false;
		const key = keyName(e);
		if (match.stage === 'invited') {
			if (key === 'Enter' || key === ' ') {
				e.preventDefault();
				const fresh = !e.repeat && this.guard.press();
				if (fresh && matchTeam(game.party).ok) this.accept();
				return true;
			}
			if (key === 'Escape') {
				e.preventDefault();
				if (!e.repeat) this.decline();
				return true;
			}
			return false;
		}
		if (key === 'c' && match.stage === 'none' && match.button) {
			e.preventDefault();
			if (!e.repeat && match.button.refusal === null) this.challenge(match.button.pid);
			return true;
		}
		return false;
	}

	/** A key while matches have the screen: asking, starting, the match, its result, the update card. */
	onKey(e: KeyboardEvent): void {
		if (isShortcut(e)) return;
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		const key = keyName(e);
		const fresh = isMashKey(key) ? this.guard.press() : this.guard.ready;
		let handled = true;
		switch (match.stage) {
			case 'asking':
				if (key === 'Escape') this.withdraw();
				break;
			case 'playing':
				// Any key on their own turn says the kid is there: the clock starts again.
				if (battle.turn === 'player' || match.nudged) this.here(match.nudged);
				if (match.nudged) match.nudged = false;
				else handled = match.leaving ? this.leaveKey(key, fresh) : this.fightKey(key, fresh);
				break;
			case 'over':
			case 'updating':
				handled = this.cardKey(key, fresh);
				break;
		}
		if (handled) e.preventDefault();
	}

	private fightKey(key: string, fresh: boolean): boolean {
		switch (battle.screen) {
			case 'actions':
				// Escape, which a kid presses for the menu, asks before leaving.
				if (key === 'Escape') {
					this.askLeave();
					return true;
				}
				return this.menuKey(key, fresh);
			case 'party':
				return this.partyKey(key, fresh);
			case 'puzzle': {
				const typed = answerKey(battle.input, key);
				battle.input = typed.input;
				if (typed.submit) this.sendPlay({ type: 'answer', input: typed.input });
				return typed.handled;
			}
			case 'waiting':
				// The other thinks: keys wait, but the kid can always leave, once asked
				// (Escape, or the card's button, which is Escape).
				if (key === 'Escape') this.askLeave();
				return true;
			default:
				// While a turn plays, keys wait.
				return true;
		}
	}

	/** "Leave the match?" comes up, Stay lit: leaving takes a second, deliberate press. */
	private askLeave(): void {
		match.leaving = true;
		match.option = 0;
		this.guard.show();
		sfx.play('move');
	}

	/**
	 * The question's keys: left and right (or a tap on one) choose between
	 * Stay and Leave, Enter picks after the quiet moment, Escape stays.
	 */
	private leaveKey(key: string, fresh: boolean): boolean {
		const tapped = tappedOption(key);
		if (tapped !== undefined) match.option = tapped === 0 ? 0 : 1;
		switch (key) {
			case 'ArrowLeft':
			case 'a':
			case 'ArrowUp':
			case 'w':
				match.option = 0;
				sfx.play('move');
				return true;
			case 'ArrowRight':
			case 'd':
			case 'ArrowDown':
			case 's':
				match.option = 1;
				sfx.play('move');
				return true;
			case 'Escape':
				this.stay();
				return true;
		}
		if (key !== 'Enter' && key !== ' ' && tapped === undefined) return false;
		if (!fresh && tapped === undefined) return true;
		if (tapped !== undefined && !this.guard.ready) return true;
		if (match.option === 0) {
			this.stay();
			return true;
		}
		match.leaving = false;
		sfx.play('confirm');
		this.sendPlay({ type: 'leave' });
		return true;
	}

	/** Stay: the question goes, and the match is as it was. */
	private stay(): void {
		match.leaving = false;
		sfx.play('move');
		// A choice back on screen waits its quiet moment again.
		this.guard.show();
	}

	private menuKey(key: string, fresh: boolean): boolean {
		const front = battle.party[battle.front];
		if (!front) return true;
		const spec = getAnimal(front.speciesId);
		const result = menuKey(
			{ cursor: battle.cursor, levels: battle.levels },
			key,
			spec,
			MATCH_MOVES
		);
		// A pick waits the quiet moment, so never from a mash; a pick it ignores changes nothing.
		if (result.choice && !fresh) return result.handled;
		const moved = result.menu.cursor !== battle.cursor;
		const leveled = result.menu.levels !== battle.levels;
		battle.cursor = result.menu.cursor;
		if (leveled) battle.levels = result.menu.levels;
		switch (result.choice?.kind) {
			case 'attack':
				sfx.play('confirm', { pitch: levelPitch(result.choice.level) });
				this.sendPlay({
					type: 'attack',
					attackIndex: result.choice.attackIndex,
					level: result.choice.level
				});
				break;
			case 'switch':
				if (battle.pickable.some(Boolean)) {
					sfx.play('confirm');
					this.openParty(false);
				}
				break;
			case 'leave':
				sfx.play('confirm');
				this.sendPlay({ type: 'leave' });
				break;
			default:
				if (moved || leveled) sfx.play('move');
		}
		return result.handled;
	}

	private partyKey(key: string, fresh: boolean): boolean {
		const { cursor, handled, choice } = listKey(battle.partyCursor, key, battle.party.length);
		if (cursor !== battle.partyCursor) {
			battle.refused = 0;
			sfx.play('move');
		}
		battle.partyCursor = cursor;
		if (choice === 'pick' && !fresh) return handled;
		if (choice === 'pick') {
			if (battle.pickable[cursor]) {
				sfx.play('confirm');
				this.sendPlay({ type: battle.mustPick ? 'pick-next' : 'switch', teamIndex: cursor });
			} else battle.refused += 1;
		} else if (choice === 'back' && !battle.mustPick) {
			sfx.play('move');
			const front = battle.party[battle.front];
			battle.cursor = front ? actionCount(getAnimal(front.speciesId).attacks.length, []) : 0;
			battle.screen = 'actions';
		}
		return handled;
	}

	/** The result's and the update card's two buttons: left and right, Enter, or a tap on one. */
	private cardKey(key: string, fresh: boolean): boolean {
		const tapped = tappedOption(key);
		if (tapped !== undefined) match.option = tapped === 0 ? 0 : 1;
		switch (key) {
			case 'ArrowLeft':
			case 'a':
			case 'ArrowUp':
			case 'w':
				match.option = 0;
				sfx.play('move');
				return true;
			case 'ArrowRight':
			case 'd':
			case 'ArrowDown':
			case 's':
				match.option = 1;
				sfx.play('move');
				return true;
			case 'Escape':
				this.goBack();
				return true;
		}
		if (key !== 'Enter' && key !== ' ' && tapped === undefined) return false;
		if (!fresh && tapped === undefined) return true;
		if (tapped !== undefined && !this.guard.ready) return true;
		if (match.option === 1) {
			sfx.play('confirm');
			this.goBack();
			return true;
		}
		if (match.stage === 'over') this.askRematch();
		else this.playAgain();
		return true;
	}

	// --- asking and being asked -------------------------------------------------------

	/** The button: ask `pid` for a match, bringing the team. */
	challenge(pid: string): void {
		const peer = this.peers.get(pid);
		const team = this.team();
		if (!peer || !team) return;
		if (!this.deps.send({ t: 'challenge', pid, team })) {
			hud.match('lost', peer.name);
			return;
		}
		sfx.play('confirm');
		match.stage = 'asking';
		match.other = { pid, name: peer.name };
		this.deadline = this.clock() + 20;
		match.total = 20;
		match.left = 20;
	}

	private withdraw(): void {
		this.deps.send({ t: 'withdraw' });
		sfx.play('move');
		match.reset();
	}

	private invited(pid: string, name: string, ms: number): void {
		// The update card: the friend asks to play again, and Play again is Yes.
		if (match.stage === 'updating' && pid === match.other?.pid) {
			match.friendAsked = true;
			this.deadline = this.clock() + ms / 1000;
			return;
		}
		if (match.stage !== 'none' || !this.exploring()) {
			// Busy with something else: no, at once, rather than an answer that never comes.
			this.deps.send({ t: 'decline', pid });
			return;
		}
		match.stage = 'invited';
		match.other = { pid, name };
		this.deadline = this.clock() + ms / 1000;
		match.total = ms / 1000;
		match.left = match.total;
		this.guard.show();
		sfx.play('lead');
	}

	private accept(): void {
		const other = match.other;
		const team = this.team();
		if (!other || !team) return;
		if (!this.deps.send({ t: 'accept', pid: other.pid, team })) {
			this.letGo('lost');
			return;
		}
		sfx.play('confirm');
		match.stage = 'starting';
		this.since = this.clock();
	}

	private decline(): void {
		const other = match.other;
		if (other) this.deps.send({ t: 'decline', pid: other.pid });
		sfx.play('move');
		match.reset();
	}

	private uninvited(pid: string, reason: InviteEnd): void {
		const stage = match.stage;
		if (stage !== 'asking' && stage !== 'invited' && stage !== 'starting') return;
		if (match.other?.pid !== pid) return;
		const name = match.other.name;
		if (reason === 'no' || reason === 'expired' || reason === 'wait') {
			this.waits.set(pid, this.clock() + ASK_AGAIN_SECONDS);
		}
		// Being asked, "nobody answered" is nothing to say: the card just goes.
		const quiet = stage === 'invited' && reason === 'expired';
		match.reset();
		if (!quiet && reason !== 'off') hud.match(reason, name);
	}

	/** An invite (or a Yes) is over here without the server's word: the socket dropped, or time ran out. */
	private letGo(said: MatchLine | null): void {
		const name = match.other?.name ?? '';
		match.reset();
		if (said) hud.match(said, name);
	}

	// --- the match ------------------------------------------------------------------------

	private hello(going: string | null, boot: string | null): void {
		// Everyone near is said again after a hi.
		this.peers.clear();
		this.boot = boot;
		if (this.wentBack !== null) {
			// The server still has the kid on the result they went back from: the `done` that went
			// with it never got there (the socket was away). It goes now, and the match the server
			// sends next is not put up again (`matchMessage`). Otherwise the server let go of it.
			if (going === this.wentBack) this.deps.send({ t: 'done', id: going });
			else this.wentBack = null;
		}
		if ((match.stage === 'playing' || match.stage === 'over') && going !== match.id) {
			// Another run of the server than the match's: it restarted without a word (a crash),
			// and the match went with it. Nobody left it: the kids can play again, one tap each
			// (a result whose rematch was off already stays as it is: `restarted`).
			const restarted = boot !== null && this.matchBoot !== null && boot !== this.matchBoot;
			if (restarted) this.restarted(true);
			// The match went on without this page, and ended: it was away too long.
			else if (match.stage === 'playing') this.missed();
			// The result's match is gone here: its rematch with it.
			else if (match.rematch.theirs !== false) match.rematch = { ...match.rematch, theirs: false };
		}
	}

	private matchMessage(m: MatchMessage): void {
		// Back to exploring is final: the match the kid went back from never comes back, however
		// the server still sends it (a page back after its `done` could not go, or a message on
		// its way as they pressed Back).
		if (m.id === this.wentBack) return;
		this.sentAt = null;
		if (m.id !== match.id) {
			this.begin(m);
			return;
		}
		// The kid's own right answers are theirs to keep, whatever else the match does.
		if (m.events.length > 0) this.deps.count?.(m.events, m.view.you);
		const was = this.latest;
		this.latest = m;
		this.awayUntil = m.away ? this.clock() + m.away.ms / 1000 : null;
		if (!m.away) match.away = null;
		if (match.stage !== 'playing') return;
		battle.screen = 'busy';
		const replacing = (was ?? m).view.phase.kind === 'choose-animal';
		for (const e of m.events) this.beats.push(...this.narrate(e, replacing));
		if (m.events.length === 0 && this.beats.length === 0) this.settle();
	}

	/** A new match (or one picked up after a drop or a reload): the screen, and who starts. */
	private begin(m: MatchMessage): void {
		const rematch = match.stage === 'over' && battle.active && !!battle.vs;
		if (!rematch && !this.canShow()) {
			// This page can't play it now (a wild battle picked up from the save): leave at once.
			this.deps.send({ t: 'play', id: m.id, intent: { type: 'leave' } });
			return;
		}
		if (pause.open || account.prompt) this.deps.stepAside?.();
		const you = m.view.you;
		const them = otherSide(you);
		match.clearMatch();
		match.stage = 'playing';
		match.id = m.id;
		// The run of the server it is played on: coming back to another means it restarted.
		this.matchBoot = this.boot;
		match.you = you;
		match.names = { a: m.names.a, b: m.names.b };
		match.other = { pid: m.pids[them], name: m.names[them] };
		this.latest = m;
		this.shownPhase = null;
		this.beats = [];
		this.wait = 0;
		this.hereAt = Number.NEGATIVE_INFINITY;
		this.awayUntil = m.away ? this.clock() + m.away.ms / 1000 : null;
		const levels = battle.levels;
		if (!rematch) {
			battle.reset();
			battle.levels = levels;
			battle.active = true;
			battle.entering = true;
			this.enterIn = ENTER_SECONDS;
			battle.transition = {
				kind: motion.reduced ? 'fade' : 'iris',
				closing: true,
				p: 0,
				...this.deps.renderer.playerScreenPoint()
			};
			sfx.play('encounter');
		}
		battle.vs = { name: match.other.name, me: m.names[you] };
		battle.moves = MATCH_MOVES;
		battle.realm = 'land';
		battle.outcome = null;
		battle.screen = 'busy';
		battle.puzzle = null;
		battle.judged = null;
		battle.input = '';
		battle.hit = null;
		battle.turn = null;
		battle.cursor = 0;
		const mine = m.view.teams[you][m.view.active[you]]!;
		const theirs = m.view.teams[them][m.view.active[them]]!;
		battle.party = m.view.teams[you].map((a) => ({ ...a }));
		battle.front = m.view.active[you];
		battle.opponent = { ...theirs };
		battle.pickable = m.view.teams[you].map((_, i) => canSendIn(m.view, you, i));
		const biome = tileAtWorld(game.seed, game.pos.x, game.pos.y).biome;
		this.scene ??= this.deps.scene?.() ?? new BattleScene();
		this.scene.begin(biome, mine.speciesId, theirs.speciesId);
		if (rematch) this.deps.renderer.setBattle(this.scene);

		const name = match.other.name;
		const phase = m.view.phase;
		if (m.view.step === 0 && phase.kind !== 'ended') {
			// The coin, out loud: who starts is the server's toss, and both see it.
			const starts = phase.side === you;
			this.beats.push({ run: () => line('match.vs', { name: { player: name } }), hold: 1.4 });
			this.beats.push({
				run: () => {
					sfx.play('lead');
					return starts
						? line('match.youStart')
						: line('match.theyStart', { name: { player: name } });
				},
				hold: 1.4
			});
		} else {
			this.beats.push({ run: () => line('match.backIn', { name: { player: name } }), hold: 1.2 });
		}
		if (mine.hp === 0) this.scene.faint('player');
		if (theirs.hp === 0) this.scene.faint('opponent');
	}

	/** Every beat has played: show the latest view, and take the keys it asks for. */
	private settle(): void {
		const m = this.latest;
		if (!m || match.stage !== 'playing') return;
		const view = m.view;
		const you = view.you;
		const them = otherSide(you);
		const name = match.other?.name ?? '';
		battle.party = view.teams[you].map((a) => ({ ...a }));
		battle.front = view.active[you];
		battle.opponent = { ...view.teams[them][view.active[them]]! };
		battle.pickable = view.teams[you].map((_, i) => canSendIn(view, you, i));
		battle.hit = null;
		battle.mustPick = false;
		const front = battle.party[battle.front]!;
		const phase = view.phase;
		this.shownPhase = phase.kind;
		switch (phase.kind) {
			case 'choose-action':
				battle.puzzle = null;
				battle.judged = null;
				battle.input = '';
				if (phase.side === you) {
					const rows = actionCount(getAnimal(front.speciesId).attacks.length, MATCH_MOVES);
					battle.cursor = Math.min(battle.cursor, rows - 1);
					battle.line = line('battle.whatNow', { animal: front });
					battle.turn = 'player';
					this.guard.show();
					battle.screen = 'actions';
				} else {
					battle.line = line('match.thinking', { name: { player: name } });
					battle.turn = 'opponent';
					battle.screen = 'waiting';
				}
				break;
			case 'choose-animal':
				battle.puzzle = null;
				battle.judged = null;
				battle.input = '';
				if (phase.side === you) {
					battle.turn = 'player';
					this.openParty(true);
					battle.line = line('battle.switch.whoIsNext', { animal: front });
				} else {
					battle.turn = 'opponent';
					battle.line = line('match.picking', { name: { player: name } });
					battle.screen = 'waiting';
				}
				break;
			case 'solving': {
				battle.puzzle = phase.puzzle;
				battle.judged = null;
				battle.input = '';
				if (phase.side === you) {
					const spec = getAnimal(front.speciesId);
					const picked = pickedMenu(
						{ cursor: battle.cursor, levels: battle.levels },
						spec,
						phase.attackIndex,
						phase.level
					);
					battle.cursor = picked.cursor;
					if (picked.levels !== battle.levels) battle.levels = picked.levels;
					battle.line = line('battle.tries', {
						animal: front,
						attack: { speciesId: front.speciesId, attackIndex: phase.attackIndex }
					});
					battle.turn = 'player';
					battle.screen = 'puzzle';
				} else {
					const foe = battle.opponent;
					battle.line = line('match.theyTry', {
						whose: { player: name, whose: true },
						animal: foe,
						attack: { speciesId: foe.speciesId, attackIndex: phase.attackIndex }
					});
					battle.turn = 'opponent';
					battle.screen = 'waiting';
				}
				break;
			}
			case 'ended': {
				battle.puzzle = null;
				battle.turn = null;
				// A question about leaving has nothing left to ask.
				match.leaving = false;
				const won = phase.winner === you;
				// Leaving is the kid's own choice: straight back to exploring.
				if (phase.reason === 'left' && !won) {
					this.finish();
					hud.match('youLeft', name);
					return;
				}
				if (won) {
					this.scene?.winCheer('player');
					sfx.play('won');
				}
				match.result = { won, reason: phase.reason, timeout: m.timeout, missed: false };
				// They left or dropped out: no rematch with them from here.
				const theyWent = won && phase.reason !== 'all-tired';
				match.rematch = { mine: false, theirs: theyWent ? false : null };
				match.option = theyWent ? 1 : 0;
				match.stage = 'over';
				battle.line = null;
				this.guard.show();
				battle.screen = 'result';
				break;
			}
		}
	}

	/** This page came back to find its match over: it says so, kindly. */
	private missed(): void {
		match.result = { won: false, reason: 'timed-out', timeout: 'dropped', missed: true };
		match.rematch = { mine: false, theirs: false };
		match.option = 1;
		match.leaving = false;
		match.stage = 'over';
		this.beats = [];
		battle.turn = null;
		battle.puzzle = null;
		battle.line = null;
		this.guard.show();
		battle.screen = 'result';
	}

	/**
	 * The server stopped: the match is over, and both can play again in a
	 * moment. `found`: this page found out coming back to a new run of the
	 * server, rather than being told it was updating (`bye: restart`).
	 */
	private restarted(found: boolean): void {
		const stage = match.stage;
		if (stage === 'asking' || stage === 'invited' || stage === 'starting') {
			this.letGo('updating');
			return;
		}
		if (stage !== 'playing' && stage !== 'over') return;
		// A result whose rematch was off already (the other left, went back, or it lapsed)
		// has nothing to play again: it stays, and nobody who left is asked back.
		if (stage === 'over' && match.rematch.theirs === false) return;
		this.beats = [];
		this.sentAt = null;
		this.awayUntil = null;
		match.away = null;
		match.nudged = false;
		match.offline = false;
		match.leaving = false;
		match.stage = 'updating';
		match.restarted = found;
		match.friendBack = false;
		match.friendAsked = false;
		match.option = 0;
		battle.turn = null;
		battle.puzzle = null;
		battle.line = null;
		this.guard.show();
		battle.screen = 'result';
	}

	/** Rematch? on the result: the server starts the next match once both have said so. */
	private askRematch(): void {
		if (match.rematch.mine || match.rematch.theirs === false || !match.id) return;
		const team = this.team();
		if (!team || !this.deps.send({ t: 'rematch', id: match.id, team })) return;
		sfx.play('confirm');
		match.rematch = { ...match.rematch, mine: true };
	}

	/** Play again, after an update: ask the same friend (or say yes to their ask). */
	private playAgain(): void {
		const other = match.other;
		if (!other || !match.friendBack) return;
		const asked = match.friendAsked;
		const team = this.team();
		if (!team) return;
		this.finish();
		if (asked) {
			match.stage = 'invited';
			match.other = other;
			this.accept();
		} else {
			this.challenge(other.pid);
		}
	}

	/**
	 * Back to exploring, the kid's own choice on the result or the update
	 * card: final for that match. `finish` tells the server (`done`); should
	 * that never get there, this page still never puts the match up again,
	 * and says `done` once more when the next `hi` names it (`hello`).
	 */
	private goBack(): void {
		this.wentBack = match.id;
		this.finish();
	}

	/**
	 * The screen goes, and nothing of the match stays. From a result the
	 * server hears so (`done`), if the socket is on: a rematch this page asked
	 * for is taken back, and the other page's Rematch? greys.
	 */
	private finish(): void {
		if (match.stage === 'over' && match.id) this.deps.send({ t: 'done', id: match.id });
		this.deps.renderer.setBattle(null);
		this.scene?.end();
		this.latest = null;
		this.shownPhase = null;
		this.beats = [];
		this.wait = 0;
		this.sentAt = null;
		this.awayUntil = null;
		const levels = battle.levels;
		battle.reset();
		battle.levels = levels;
		match.reset();
	}

	private sendPlay(intent: PlayIntent): void {
		const id = match.id;
		if (!id) return;
		if (!this.deps.send({ t: 'play', id, intent })) {
			match.offline = true;
			return;
		}
		battle.screen = 'busy';
		this.sentAt = this.clock();
		this.hereAt = this.clock();
	}

	/** The kid is at the keys on their turn: the server's clock starts again, now and then. */
	private here(now: boolean): void {
		const at = this.clock();
		if (!match.id || (!now && at - this.hereAt < HERE_SECONDS)) return;
		if (this.deps.send({ t: 'here', id: match.id })) this.hereAt = at;
	}

	private openParty(mustPick: boolean): void {
		battle.mustPick = mustPick;
		battle.partyCursor = firstPickable(battle.pickable);
		battle.refused = 0;
		this.guard.show();
		battle.screen = 'party';
	}

	// --- narration --------------------------------------------------------------------------

	/**
	 * One match event as beats, from this page's side: its own animal is
	 * `player`, the other's `opponent`, named with its owner ("Bo's Rabbit").
	 * `replacing`: the switch came after a knock-out, so nobody is called back.
	 */
	private narrate(e: WireMatchEvent, replacing: boolean): Beat[] {
		const scene = this.scene!;
		const you = match.you;
		const name = match.other?.name ?? '';
		const owner = { player: name, whose: true } as const;
		const sideOf = (s: MatchSide): BattleSide => (s === you ? 'player' : 'opponent');
		switch (e.type) {
			case 'puzzle-shown':
			case 'ended':
				return []; // `settle` shows them
			case 'answer-judged': {
				const mine = e.side === you;
				return [
					{
						run: () => {
							battle.judged = { correct: e.correct };
							sfx.play(e.correct ? 'correct' : 'wrong');
							if (mine) return line(e.correct ? 'puzzle.correct' : 'puzzle.notQuite');
							return line(e.correct ? 'match.theyRight' : 'match.theyWrong', {
								name: { player: name }
							});
						},
						hold: 1.0
					}
				];
			}
			case 'hit': {
				const attacker = sideOf(e.attacker);
				const target: BattleSide = attacker === 'player' ? 'opponent' : 'player';
				let who: AnimalInstance;
				return [
					{
						run: () => {
							scene.lunge(attacker);
							battle.turn = attacker;
							who = this.animalOn(attacker);
							const attack = { speciesId: who.speciesId, attackIndex: e.attackIndex };
							return attacker === 'player'
								? line('battle.used', { animal: who, attack })
								: line('match.theirUsed', { whose: owner, animal: who, attack });
						},
						hold: 0.35
					},
					{
						run: () => {
							scene.shake(target);
							sfx.play('hit');
							if (target === 'opponent') {
								battle.opponent = { ...battle.opponent!, hp: e.targetHp };
							} else {
								battle.party = battle.party.map((a, i) =>
									i === battle.front ? { ...a, hp: e.targetHp } : a
								);
							}
							battle.hit = { side: target, damage: e.damage, level: e.level, n: ++this.hits };
							const attack = { speciesId: who.speciesId, attackIndex: e.attackIndex };
							const params = {
								whose: owner,
								animal: who,
								attack,
								damage: e.damage,
								target: this.animalOn(target)
							};
							return attacker === 'player'
								? line('match.usedDamage', params)
								: line('match.theirUsedDamage', params);
						},
						hold: 1.2
					}
				];
			}
			case 'missed': {
				const attacker = sideOf(e.attacker);
				if (attacker === 'player') {
					return [
						{
							run: () => {
								scene.lunge('player');
								scene.puff('opponent');
								return line('match.youMissed', { whose: owner, animal: battle.opponent! });
							},
							hold: 1.3
						}
					];
				}
				const foe = battle.opponent!;
				const attack = { speciesId: foe.speciesId, attackIndex: e.attackIndex };
				return [
					{
						run: () => {
							scene.lunge('opponent');
							battle.turn = 'opponent';
							return line('match.theirUsed', { whose: owner, animal: foe, attack });
						},
						hold: 0.35
					},
					{
						run: () => {
							scene.puff('player');
							return line('match.theirMissed', { whose: owner, animal: foe, attack });
						},
						hold: 1.2
					}
				];
			}
			case 'fainted': {
				const side = sideOf(e.side);
				return [
					{
						run: () => {
							scene.faint(side);
							sfx.play('faint');
							return side === 'player'
								? line('battle.tired', { animal: e.animal })
								: line('match.theirTired', { whose: owner, animal: e.animal });
						},
						hold: 1.2
					}
				];
			}
			case 'switched': {
				const side = sideOf(e.side);
				const enter: Beat = {
					run: () => {
						if (side === 'player') {
							battle.front = e.teamIndex;
							battle.cursor = 0;
						} else {
							battle.opponent = { ...e.animal };
						}
						scene.setFigure(side, e.animal.speciesId);
						scene.appear(side);
						return side === 'player'
							? line('battle.go', { animal: e.animal })
							: line('match.theirGo', { name: { player: name }, animal: e.animal });
					},
					hold: 1.0
				};
				if (replacing) return [enter];
				const leave: Beat = {
					run: () => {
						scene.recall(side);
						const out = this.animalOn(side);
						return side === 'player'
							? line('battle.switch.comeBack', { animal: out })
							: line('match.theirComeBack', { name: { player: name }, animal: out });
					},
					hold: 0.9
				};
				return [leave, enter];
			}
		}
	}

	private animalOn(side: BattleSide): AnimalInstance {
		return side === 'player' ? battle.party[battle.front]! : battle.opponent!;
	}

	// --- this page ------------------------------------------------------------------------

	/** The team this player brings, as the wire carries it; null with no animal that fights on land. */
	private team(): WireAnimal[] | null {
		const pick = matchTeam(game.party);
		if (!pick.ok) return null;
		return pick.team.map(({ id, speciesId, nickname }) =>
			nickname === undefined ? { id, speciesId } : { id, speciesId, nickname }
		);
	}

	/**
	 * Exploring with nothing over it: no battle, card, menu, trip or account
	 * card, and feet on the ground (up in the air with the glider, the others see
	 * a `flight`, which the server's rule turns away too).
	 */
	private exploring(): boolean {
		return (
			game.mode === 'explore' &&
			!game.flying &&
			!battle.active &&
			!doctor.active &&
			!pause.open &&
			!travel.active &&
			!title.open &&
			account.card === null &&
			!account.prompt
		);
	}

	/** Whether a match can take the screen now: from explore, or over the pause menu. */
	private canShow(): boolean {
		return (
			game.mode === 'explore' && !battle.active && !doctor.active && !travel.active && !title.open
		);
	}
}
