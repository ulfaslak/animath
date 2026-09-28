import type { ChallengeRefusal, MatchEndReason, MatchSide, MatchTimeout } from '@mathgame/engine';

/**
 * What the page shows of friendly matches, written only by
 * `MatchController` (`match/controller.ts`): the Challenge button, the
 * invite, and what the match adds to the battle's screen, which draws the
 * match itself (`battle`, with `battle.vs`): its result, the rematch, and its
 * notes (the other dropped out, "Still there?", the connection).
 *
 * `stage` says where the player is:
 * - `none`: exploring; the Challenge button shows when someone is near.
 * - `asking`: waiting for the one asked (`other`) to answer; walking waits.
 * - `invited`: `other` asked; the card is up over explore, and walking goes on.
 * - `starting`: the player said yes; the match is on its way.
 * - `playing`: the match screen, until its result.
 * - `over`: the result: who won, Rematch? and Back to exploring.
 * - `updating`: the server stopped mid-match, for a new version (it said
 *   so) or without a word (`restarted`: the page came back to a new run of
 *   it); the card says so, and Play again asks the same friend once both are
 *   back.
 */
export type MatchStage =
	'none' | 'asking' | 'invited' | 'starting' | 'playing' | 'over' | 'updating';

/**
 * Why the Challenge button can't be pressed: the engine's rule
 * (`challengeRefusal`, but never `far`: nobody within reach is no button),
 * the player's own team (`no-team`), or a No a moment ago (`wait`).
 */
export type ButtonRefusal = Exclude<ChallengeRefusal, 'far' | 'busy'> | 'no-team' | 'wait';

/** The Challenge button: the nearest player within reach, and why not, when not. */
export interface ChallengeButton {
	pid: string;
	name: string;
	refusal: ButtonRefusal | null;
}

/** How a match ended, for the result: who won, and how. */
export interface MatchResult {
	won: boolean;
	reason: MatchEndReason;
	/** A time-out's why: the other page dropped out, or a kid sat on a turn. */
	timeout: MatchTimeout | null;
	/** The match ended while this page was away from it (it came back to no match). */
	missed: boolean;
}

class MatchStateView {
	stage = $state<MatchStage>('none');
	/** The other player: the one asked, the one asking, the opponent. */
	other = $state<{ pid: string; name: string } | null>(null);
	/** Seconds left to answer the invite, and how many there were. */
	left = $state(0);
	total = $state(0);
	/** The Challenge button, or null with nobody within reach (or not exploring). */
	button = $state.raw<ChallengeButton | null>(null);
	/** The choice on screen takes a pick now: its quiet moment has passed. */
	ready = $state(false);
	/** The highlighted button of the result's, the update card's and the leave question's pair. */
	option = $state(0);
	/** The socket is not on: the match waits for it, and says so. */
	offline = $state(false);
	/** The other player dropped out: seconds they have left to come back. */
	away = $state<number | null>(null);
	/** "Still there?": the kid has not touched a key on their turn for a while. */
	nudged = $state(false);
	/** "Leave the match?" is up over the match (Escape): Stay (`option` 0, lit first) or Leave. */
	leaving = $state(false);

	// --- the match on screen (the battle's screen draws it: `battle.vs`) ---------------

	id = $state<string | null>(null);
	you = $state<MatchSide>('a');
	names = $state.raw<Record<MatchSide, string>>({ a: '', b: '' });
	/** The result, once the match ended and its last beats played. */
	result = $state.raw<MatchResult | null>(null);
	/** After the result: whether each wants a rematch (`theirs` false: they can't, or went back). */
	rematch = $state.raw<{ mine: boolean; theirs: boolean | null }>({ mine: false, theirs: null });
	/** On the update card: the friend is back, so Play again can ask them. */
	friendBack = $state(false);
	/** On the update card: the friend asked already, so Play again says yes. */
	friendAsked = $state(false);
	/** On the update card: the server restarted without saying it would (found on coming back), not updating. */
	restarted = $state(false);

	/**
	 * A note is up over the match's screen (`MatchNotes`): the connection is
	 * being found again, the other dropped out, or "Still there?".
	 */
	get noted(): boolean {
		if (this.stage === 'over') return this.offline;
		return this.stage === 'playing' && (this.offline || this.away !== null || this.nudged);
	}

	/** Everything back to nothing going on. */
	reset(): void {
		this.stage = 'none';
		this.other = null;
		this.left = 0;
		this.total = 0;
		this.ready = false;
		this.option = 0;
		this.offline = false;
		this.away = null;
		this.nudged = false;
		this.clearMatch();
	}

	/** The match's own part back to nothing (between a match and a rematch too). */
	clearMatch(): void {
		this.id = null;
		this.you = 'a';
		this.names = { a: '', b: '' };
		this.result = null;
		this.rematch = { mine: false, theirs: null };
		this.friendBack = false;
		this.friendAsked = false;
		this.restarted = false;
		this.away = null;
		this.nudged = false;
		this.leaving = false;
		this.offline = false;
	}
}

export const match = new MatchStateView();
