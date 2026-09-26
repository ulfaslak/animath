import {
	getItem,
	keepsATeam,
	needsHealing,
	type AnimalInstance,
	type ItemId,
	type Puzzle
} from '@mathgame/engine';
import type { DoctorLine } from '../doctor/lines';
import type { DoctorTab } from '../doctor/tabs';

export { DOCTOR_TABS, type DoctorTab } from '../doctor/tabs';

/**
 * What the doctor's card shows. Filled only by `DoctorController`, which
 * plays the authority's doctor events back a beat at a time (a judgement,
 * then a heal, animals going home, tokens changing hands) before showing the
 * latest state, as the battle screen does. Svelte components read it and
 * never write it.
 *
 * The card has three tabs ([[UI_SPEC]] § Doctor): **heal** (the hurt animals),
 * **home** (help animals home to the wild, for tokens) and **shop** (buy an
 * item with tokens). `screen` says what the keyboard does: `list` moves the
 * cursor over the tab's rows (← → change the tab), `confirm` asks before a
 * hand-over, `puzzle` types an answer (a healing puzzle or a token sum),
 * `busy` ignores everything but Escape while a beat plays.
 */
export type DoctorScreen = 'list' | 'confirm' | 'puzzle' | 'busy';

/** The token sum that is open: what it is for, and what changes hands. */
export type DoctorTrade =
	| { kind: 'home'; ids: readonly string[]; reward: number }
	| { kind: 'buy'; itemId: ItemId; price: number };

/**
 * A row of a tab's list. The animals come grouped by species (the order each
 * species first comes in the party, then party order within it), since one
 * healing puzzle helps a whole species; `groupStart` marks the first of a
 * group after the first. `send` is Help home's button, and `bye` ends every
 * list.
 */
export type DoctorRow =
	| { kind: 'animal'; partyIndex: number; groupStart: boolean }
	| { kind: 'item'; itemId: ItemId }
	| { kind: 'send' }
	| { kind: 'bye' };

class DoctorView {
	/** True from `doctor-visit-started` until `doctor-visit-ended`. */
	active = $state(false);
	party = $state<AnimalInstance[]>([]);
	/** The player's tokens as the card shows them: they change on their beat. */
	tokens = $state(0);
	/** The ids of the items the player owns, as the card shows them. */
	items = $state<string[]>([]);
	/** What the shop sells in this visit. */
	shop = $state<ItemId[]>([]);
	/** What the doctor is saying, worded by the card in the language on screen. */
	line = $state<DoctorLine | null>(null);
	tab = $state<DoctorTab>('heal');
	/** Highlighted row: an index into the tab's rows (`tabRows`). */
	cursor = $state(0);
	/** The animals picked on the home tab to go home, by id. */
	marked = $state<string[]>([]);
	/** The confirm before a hand-over: 0 lights "No, keep them", 1 "Yes, bye bye!". */
	confirm = $state<0 | 1>(0);
	/** The animal whose healing puzzle is open. */
	patient = $state<number | null>(null);
	/** The token sum that is open, or null. */
	trade = $state<DoctorTrade | null>(null);
	/** The tokens the open token sum starts from. */
	balance = $state(0);
	puzzle = $state<Puzzle | null>(null);
	/** The answer typed so far. */
	input = $state('');
	/** How the last answer was judged. Never the right answer: the kid may meet it again. */
	judged = $state<{ correct: boolean } | null>(null);
	screen = $state<DoctorScreen>('busy');
	/**
	 * The heal being cheered, from its beat until the list takes keys again:
	 * each healed animal's row (by party index) lights up and a "+N" pops over
	 * it; `n` restarts the pop.
	 */
	healed = $state<{ amounts: Record<number, number>; n: number } | null>(null);
	/** The animals going home, by id, while their goodbye plays. */
	leaving = $state<string[] | null>(null);
	/** Tokens just given or spent: the "+N" or "−N" over the tokens; `n` restarts it. */
	tokenPop = $state<{ amount: number; n: number } | null>(null);
	/** The item just bought, while its row cheers. */
	bought = $state<ItemId | null>(null);
	/** A row that can't be picked, shaking once; `n` restarts the shake. */
	shake = $state<{ row: number; n: number } | null>(null);

	reset(): void {
		this.active = false;
		this.party = [];
		this.tokens = 0;
		this.items = [];
		this.shop = [];
		this.line = null;
		this.tab = 'heal';
		this.cursor = 0;
		this.marked = [];
		this.confirm = 0;
		this.patient = null;
		this.trade = null;
		this.balance = 0;
		this.puzzle = null;
		this.input = '';
		this.judged = null;
		this.screen = 'busy';
		this.healed = null;
		this.leaving = null;
		this.tokenPop = null;
		this.bought = null;
		this.shake = null;
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

/**
 * Party indexes grouped by species: the species in the order each first
 * comes in the party, and within a species in party order.
 */
export function groupedIndexes(party: readonly AnimalInstance[]): number[] {
	const species: string[] = [];
	for (const a of party) if (!species.includes(a.speciesId)) species.push(a.speciesId);
	return species.flatMap((s) => party.flatMap((a, i) => (a.speciesId === s ? [i] : [])));
}

/** The rows of a tab's list, top to bottom. */
export function tabRows(
	tab: DoctorTab,
	party: readonly AnimalInstance[],
	shop: readonly ItemId[]
): DoctorRow[] {
	if (tab === 'shop') {
		return [...shop.map((itemId) => ({ kind: 'item' as const, itemId })), { kind: 'bye' }];
	}
	const animals: DoctorRow[] = groupedIndexes(party).map((partyIndex, k, order) => ({
		kind: 'animal',
		partyIndex,
		groupStart: k > 0 && party[order[k - 1]!]!.speciesId !== party[partyIndex]!.speciesId
	}));
	return tab === 'home'
		? [...animals, { kind: 'send' }, { kind: 'bye' }]
		: [...animals, { kind: 'bye' }];
}

/**
 * The rows the cursor stops on: on **heal** the animals who need the doctor
 * (fit ones are shown, greyed, and skipped); on **home** every animal, and
 * Help home once one is picked; on **shop** every item, the ones that can't
 * be bought too (the card says why); and Bye on every tab.
 */
export function rowStops(rows: readonly DoctorRow[], view: StopsView): number[] {
	return rows.flatMap((row, k) => {
		switch (row.kind) {
			case 'animal':
				return view.tab !== 'heal' || needsHealing(view.party[row.partyIndex]!) ? [k] : [];
			case 'send':
				return view.marked.length > 0 ? [k] : [];
			case 'item':
			case 'bye':
				return [k];
		}
	});
}

/** What `rowStops` reads. */
export interface StopsView {
	tab: DoctorTab;
	party: readonly AnimalInstance[];
	marked: readonly string[];
}

/**
 * Whether `animal` may be picked to go home, with `marked` picked already:
 * somebody who isn't tired and can walk on with the kid must stay (the
 * engine's `keep-one`, `keepsATeam`).
 */
export function canGoHome(
	animal: AnimalInstance,
	party: readonly AnimalInstance[],
	marked: readonly string[]
): boolean {
	return keepsATeam(party.filter((a) => a.id !== animal.id && !marked.includes(a.id)));
}

/** Why an item can't be bought now, or null when it can. */
export function cannotBuy(
	itemId: ItemId,
	view: { tokens: number; items: readonly string[] }
): 'owned' | 'short' | null {
	if (view.items.includes(itemId)) return 'owned';
	return view.tokens < getItem(itemId).price ? 'short' : null;
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
