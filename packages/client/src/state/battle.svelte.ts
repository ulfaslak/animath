import type { AnimalInstance, AttackLevel, BattleOutcome, Puzzle } from '@mathgame/engine';

/**
 * What the battle screen shows. Filled only by `BattleController`, which
 * plays the authority's battle events back one beat at a time so HP bars and
 * the narration move at a pace a kid can follow. The authoritative state is
 * in the events; this view lags it by design ("animate the events, then show
 * the state"). Svelte components read it and never write it.
 *
 * `screen` says what the keyboard does: `actions` navigates the menu,
 * `puzzle` types an answer, `busy` ignores everything while events play,
 * `result` waits for Enter to leave.
 */
export type BattleScreen = 'actions' | 'puzzle' | 'busy' | 'result';

class BattleView {
	/** True from `battle-started` until the player leaves the result card. */
	active = $state(false);
	party = $state<AnimalInstance[]>([]);
	/** Index into `party` of the animal in front. */
	front = $state(0);
	opponent = $state<AnimalInstance | null>(null);
	screen = $state<BattleScreen>('busy');
	/** Highlighted row of the action menu: the attacks, then Leash, then Run. */
	cursor = $state(0);
	/** The level the highlighted attack will be used at. Kept from battle to battle. */
	level = $state<AttackLevel>(1);
	puzzle = $state<Puzzle | null>(null);
	/** The answer typed so far. */
	input = $state('');
	judged = $state<{ correct: boolean; answer: number } | null>(null);
	/** The one-line narration above the panel. */
	line = $state('');
	/** The latest hit, for the damage number that pops over a status box; `n` restarts it. */
	hit = $state<{ side: 'player' | 'opponent'; damage: number; n: number } | null>(null);
	outcome = $state<BattleOutcome | null>(null);
	/** The authority's closing message, shown under the result headline. */
	closing = $state('');

	/** Clear everything but the attack level. */
	reset(): void {
		this.active = false;
		this.party = [];
		this.front = 0;
		this.opponent = null;
		this.screen = 'busy';
		this.cursor = 0;
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

/** What the menu row at `cursor` does, given how many attacks the animal has. */
export type BattleAction = { kind: 'attack'; index: number } | { kind: 'leash' } | { kind: 'run' };

export function actionAt(cursor: number, attackCount: number): BattleAction {
	if (cursor < attackCount) return { kind: 'attack', index: cursor + 1 };
	return cursor === attackCount ? { kind: 'leash' } : { kind: 'run' };
}

/** Rows in the action menu: every attack, then Leash and Run. */
export function actionCount(attackCount: number): number {
	return attackCount + 2;
}
