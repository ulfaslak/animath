import { needsHealing, type AnimalInstance, type Puzzle } from '@mathgame/engine';

/**
 * What the doctor's card shows. Filled only by `DoctorController`, which
 * plays the authority's doctor events back a beat at a time (a judgement,
 * then a heal) before showing the latest state, as the battle screen does.
 * Svelte components read it and never write it.
 *
 * `screen` says what the keyboard does: `list` moves the cursor over the
 * party and Bye, `puzzle` types an answer (and up/down swap the patient),
 * `busy` ignores everything but Escape while a beat plays.
 */
export type DoctorScreen = 'list' | 'puzzle' | 'busy';

class DoctorView {
	/** True from `doctor-visit-started` until `doctor-visit-ended`. */
	active = $state(false);
	party = $state<AnimalInstance[]>([]);
	/** What the doctor is saying. */
	line = $state('');
	/** Highlighted row: a party index, or `party.length` for Bye. */
	cursor = $state(0);
	/** The animal whose puzzle is open. */
	patient = $state<number | null>(null);
	puzzle = $state<Puzzle | null>(null);
	/** The answer typed so far. */
	input = $state('');
	/** How the last answer was judged. Never the right answer: the kid may meet it again. */
	judged = $state<{ correct: boolean } | null>(null);
	screen = $state<DoctorScreen>('busy');
	/**
	 * The heal being cheered, from its beat until the list takes keys again:
	 * its row lights up and a "+N" pops over it; `n` restarts the pop.
	 */
	healed = $state<{ index: number; amount: number; n: number } | null>(null);

	reset(): void {
		this.active = false;
		this.party = [];
		this.line = '';
		this.cursor = 0;
		this.patient = null;
		this.puzzle = null;
		this.input = '';
		this.judged = null;
		this.screen = 'busy';
		this.healed = null;
	}
}

export const doctor = new DoctorView();

/** The party indexes the doctor can help, in party order. Healthy animals are shown but skipped. */
export function hurtIndexes(party: readonly AnimalInstance[]): number[] {
	const out: number[] = [];
	party.forEach((a, i) => {
		if (needsHealing(a)) out.push(i);
	});
	return out;
}

/** Rows the list cursor can land on: every hurt animal, then Bye (`party.length`). */
export function cursorStops(party: readonly AnimalInstance[]): number[] {
	return [...hurtIndexes(party), party.length];
}

/**
 * The stop `delta` rows away from `from` in `stops`, wrapping round. When
 * `from` is not a stop (the animal there was just healed), the search starts
 * from where it would be.
 */
export function stepCursor(stops: readonly number[], from: number, delta: 1 | -1): number {
	if (stops.length === 0) return from;
	const at = stops.indexOf(from);
	if (at >= 0) return stops[(at + delta + stops.length) % stops.length]!;
	const next = stops.findIndex((s) => s > from);
	const i = next === -1 ? 0 : next;
	return delta === 1 ? stops[i]! : stops[(i - 1 + stops.length) % stops.length]!;
}
