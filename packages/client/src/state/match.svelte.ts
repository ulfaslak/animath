import type {
	AnimalInstance,
	ChallengeRefusal,
	MatchEndReason,
	MatchSide,
	MatchTimeout,
	ShownPuzzle
} from '@mathgame/engine';
import type { Line } from '../lines';

/**
 * What the page shows of friendly matches, written only by
 * `MatchController` (`match/controller.ts`): the Challenge button, the
 * invite, and the match itself, played back from the server's views a beat
 * at a time as a battle is.
 *
 * `stage` says where the player is:
 * - `none`: exploring; the Challenge button shows when someone is near.
 * - `asking`: waiting for the one asked (`other`) to answer; walking waits.
 * - `invited`: `other` asked; the card is up over explore, and walking goes on.
 * - `starting`: the player said yes; the match is on its way.
 * - `playing`: the match screen, until its result.
 * - `over`: the result: who won, Rematch? and Back to exploring.
 * - `updating`: the server stopped for a new version mid-match; the card
 *   says so, and Play again asks the same friend once both are back.
 */
export type MatchStage = 'none' | 'asking' | 'invited' | 'starting' | 'playing' | 'over' | 'updating';

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

/** What the match screen's keys drive, as the battle's (`battle.screen`), plus waiting on the other. */
export type MatchScreen = 'actions' | 'party' | 'puzzle' | 'waiting' | 'busy' | 'result';

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
	/** The highlighted button of the result's and the update card's pair. */
	option = $state(0);
	/** The socket is not on: the match waits for it, and says so. */
	offline = $state(false);
	/** The other player dropped out: seconds they have left to come back. */
	away = $state<number | null>(null);
	/** "Still there?": the kid has not touched a key on their turn for a while. */
	nudged = $state(false);

	// --- the match on screen, as it is played back ------------------------------------

	id = $state<string | null>(null);
	you = $state<MatchSide>('a');
	names = $state.raw<Record<MatchSide, string>>({ a: '', b: '' });
	/** This player's team as shown, and who is in front. */
	team = $state.raw<AnimalInstance[]>([]);
	front = $state(0);
	/** The other side's team as shown, and who is in front. */
	theirs = $state.raw<AnimalInstance[]>([]);
	theirFront = $state(0);
	/** Which side acts now (null once it ended), as shown. */
	acting = $state<MatchSide | null>(null);
	screen = $state<MatchScreen>('busy');
	/** Highlighted row of the menu: the attacks, then Switch and Leave. */
	cursor = $state(0);
	/** Highlighted animal of the switch list, by team index. */
	partyCursor = $state(0);
	/** Who could step in now, by team index: the engine's `canSendIn` on the view on screen. */
	pickable = $state.raw<boolean[]>([]);
	/** The switch list is up because the animal in front is tired: someone must be picked. */
	mustPick = $state(false);
	/** Counts picks of an animal who can't step in; each one shakes its row. */
	refused = $state(0);
	/** The puzzle on screen: this player's, or the other's while they think (never an answer). */
	puzzle = $state.raw<ShownPuzzle | null>(null);
	/** Whose puzzle is on screen, with its attack and level. */
	puzzleOf = $state.raw<{ side: MatchSide; attackIndex: number; level: 1 | 2 | 3 } | null>(null);
	/** The answer typed so far. */
	input = $state('');
	/** How the last answer was judged, and whose it was. Never the right answer. */
	judged = $state.raw<{ side: MatchSide; correct: boolean } | null>(null);
	/** The narration line above the panel, as data. */
	line = $state.raw<Line | null>(null);
	/** The latest hit, for the damage that pops over a status box; `n` restarts it. */
	hit = $state.raw<{ side: 'player' | 'opponent'; damage: number; n: number } | null>(null);
	/** The result, once the match ended and its last beats played. */
	result = $state.raw<MatchResult | null>(null);
	/** After the result: whether each wants a rematch (`theirs` false: they went back). */
	rematch = $state.raw<{ mine: boolean; theirs: boolean | null }>({ mine: false, theirs: null });

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
		this.team = [];
		this.front = 0;
		this.theirs = [];
		this.theirFront = 0;
		this.acting = null;
		this.screen = 'busy';
		this.cursor = 0;
		this.partyCursor = 0;
		this.pickable = [];
		this.mustPick = false;
		this.refused = 0;
		this.puzzle = null;
		this.puzzleOf = null;
		this.input = '';
		this.judged = null;
		this.line = null;
		this.hit = null;
		this.result = null;
		this.rematch = { mine: false, theirs: null };
	}
}

export const match = new MatchStateView();
