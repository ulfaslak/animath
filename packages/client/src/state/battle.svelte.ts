import type {
	AnimalInstance,
	AttackLevel,
	BattleOutcome,
	BattleSide,
	Line as MessageLine,
	Realm,
	ShownPuzzle
} from '@mathgame/engine';
import { WILD_MOVES, type FightMove, type Levels } from '../battle/menu';
import type { Line } from '../lines';

/**
 * What the battle screen shows. Filled by `BattleController` for a wild
 * battle, which plays the authority's battle events back one beat at a time
 * so HP bars and the narration move at a pace a kid can follow, and by
 * `MatchController` for a friendly match (`vs`), which plays the server's
 * match events back the same way: a match is drawn on the battle's screen.
 * The authoritative state is in the events; this view lags it by design
 * ("animate the events, then show the state"). Svelte components read it and
 * never write it.
 *
 * `screen` says what the keyboard does: `actions` navigates the menu,
 * `party` picks an animal to send in, `puzzle` types an answer, `waiting`
 * watches the other player's turn in a match (nothing to press), `busy`
 * ignores everything while events play, `result` waits for Enter to leave.
 */
export type BattleScreen = 'actions' | 'party' | 'puzzle' | 'waiting' | 'busy' | 'result';

/** The two players of a friendly match on the battle's screen: the other (`name`) and this one (`me`). */
export interface Versus {
	name: string;
	me: string;
}

/**
 * The encounter transition over the whole screen (UI_SPEC § Battle mode):
 * an iris closing on the player (`closing`), then opening on the wild
 * animal; or, with reduced motion, a soft dim that comes and goes (`fade`).
 * `p` runs 0..1 through each half; `x`, `y` are the centre in CSS pixels.
 */
export interface BattleTransition {
	kind: 'iris' | 'fade';
	closing: boolean;
	p: number;
	x: number;
	y: number;
}

class BattleView {
	/** True from `battle-started` until the player leaves the result card. */
	active = $state(false);
	/**
	 * True for the first moments of `active`, while the step into the grass
	 * finishes on screen; the battle screen appears when it turns false.
	 */
	entering = $state(false);
	/** The encounter transition while it plays, else null. Written only by the controller. */
	transition = $state<BattleTransition | null>(null);
	party = $state<AnimalInstance[]>([]);
	/** Index into `party` of the animal in front. */
	front = $state(0);
	opponent = $state<AnimalInstance | null>(null);
	/** The leash's quality multiplier (1 is the starter leash), for the Leash row's hint. */
	leashQuality = $state(1);
	/** Where the battle is fought: on land, or out on the water, where only the animals that swim fight. */
	realm = $state<Realm>('land');
	screen = $state<BattleScreen>('busy');
	/**
	 * The choice on screen (the menu, a switch list, the result card) takes a
	 * pick now: its quiet moment has passed (`input/pick-guard.ts`). Go! and
	 * the result card's button stay dimmed until then.
	 */
	ready = $state(false);
	/** Highlighted row of the action menu: the attacks, then Leash, Switch and Run. */
	cursor = $state(0);
	/** Each attack's own level, by species and attack (`menu.ts`). Kept from battle to battle. */
	levels = $state<Levels>({});
	/** Highlighted animal of the party list, by party index. */
	partyCursor = $state(0);
	/** Who could step in, by party index: the engine's `canSwitchTo` on the state on screen. */
	pickable = $state<boolean[]>([]);
	/** The party list is up because the animal in front is tired: someone must be picked. */
	mustPick = $state(false);
	/** Counts picks of an animal who can't step in; each one shakes the highlighted row. */
	refused = $state(0);
	/** The puzzle on screen: the player's own, or in a match the other's while they think. Never an answer. */
	puzzle = $state<ShownPuzzle | null>(null);
	/** The answer typed so far. */
	input = $state('');
	/** How the last answer was judged. Never the right answer: UI_SPEC keeps it hidden. */
	judged = $state<{ correct: boolean } | null>(null);
	/** The one-line narration above the panel, as data: worded when drawn. */
	line = $state<Line | null>(null);
	/**
	 * The latest hit, for the burst that pops beside the status box of the
	 * animal hit: its damage, and its level, which sizes the burst; `n`
	 * restarts it.
	 */
	hit = $state<{ side: BattleSide; damage: number; level: AttackLevel; n: number } | null>(null);
	/**
	 * Whose turn it is, for the cue on that animal's status box: the player's
	 * while a choice or a puzzle is up and while its own move plays out, the
	 * wild animal's while its reply does; nobody's through the opening lines
	 * and on the result card.
	 */
	turn = $state<BattleSide | null>(null);
	outcome = $state<BattleOutcome | null>(null);
	/** The authority's closing line, shown under the result headline. */
	closing = $state<MessageLine | null>(null);
	/** A friendly match on this screen: the other player. Null in a wild battle. */
	vs = $state.raw<Versus | null>(null);
	/** The row of moves after the attacks: a wild battle's Leash, Switch and Run, a match's Switch and Leave. */
	moves = $state.raw<readonly FightMove[]>(WILD_MOVES);

	/** Clear everything but the attack levels. */
	reset(): void {
		this.active = false;
		this.entering = false;
		this.transition = null;
		this.party = [];
		this.front = 0;
		this.opponent = null;
		this.leashQuality = 1;
		this.realm = 'land';
		this.screen = 'busy';
		this.ready = false;
		this.cursor = 0;
		this.partyCursor = 0;
		this.pickable = [];
		this.mustPick = false;
		this.refused = 0;
		this.puzzle = null;
		this.input = '';
		this.judged = null;
		this.line = null;
		this.hit = null;
		this.turn = null;
		this.outcome = null;
		this.closing = null;
		this.vs = null;
		this.moves = WILD_MOVES;
	}
}

export const battle = new BattleView();
