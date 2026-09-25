import type { AnimalInstance, BattleOutcome, Puzzle } from '@mathgame/engine';
import type { Levels } from '../battle/menu';

/**
 * What the battle screen shows. Filled only by `BattleController`, which
 * plays the authority's battle events back one beat at a time so HP bars and
 * the narration move at a pace a kid can follow. The authoritative state is
 * in the events; this view lags it by design ("animate the events, then show
 * the state"). Svelte components read it and never write it.
 *
 * `screen` says what the keyboard does: `actions` navigates the menu,
 * `party` picks an animal to send in, `puzzle` types an answer, `busy`
 * ignores everything while events play, `result` waits for Enter to leave.
 */
export type BattleScreen = 'actions' | 'party' | 'puzzle' | 'busy' | 'result';

class BattleView {
	/** True from `battle-started` until the player leaves the result card. */
	active = $state(false);
	/**
	 * True for the first moments of `active`, while the step into the grass
	 * finishes on screen; the battle screen appears when it turns false.
	 */
	entering = $state(false);
	party = $state<AnimalInstance[]>([]);
	/** Index into `party` of the animal in front. */
	front = $state(0);
	opponent = $state<AnimalInstance | null>(null);
	/** The leash's quality multiplier (1 is the starter leash), for the Leash row's hint. */
	leashQuality = $state(1);
	screen = $state<BattleScreen>('busy');
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
	puzzle = $state<Puzzle | null>(null);
	/** The answer typed so far. */
	input = $state('');
	/** How the last answer was judged. Never the right answer: UI_SPEC keeps it hidden. */
	judged = $state<{ correct: boolean } | null>(null);
	/** The one-line narration above the panel. */
	line = $state('');
	/** The latest hit, for the damage number that pops over a status box; `n` restarts it. */
	hit = $state<{ side: 'player' | 'opponent'; damage: number; n: number } | null>(null);
	outcome = $state<BattleOutcome | null>(null);
	/** The authority's closing message, shown under the result headline. */
	closing = $state('');

	/** Clear everything but the attack levels. */
	reset(): void {
		this.active = false;
		this.entering = false;
		this.party = [];
		this.front = 0;
		this.opponent = null;
		this.leashQuality = 1;
		this.screen = 'busy';
		this.cursor = 0;
		this.partyCursor = 0;
		this.pickable = [];
		this.mustPick = false;
		this.refused = 0;
		this.puzzle = null;
		this.input = '';
		this.judged = null;
		this.line = '';
		this.hit = null;
		this.outcome = null;
		this.closing = '';
	}
}

export const battle = new BattleView();
