import {
	FIRST_LAND,
	bundles,
	kindGoingHome,
	needsHealing,
	type AnimalInstance,
	type ItemId,
	type LandId,
	type Puzzle
} from '@mathgame/engine';
import type { DoctorLine } from '../doctor/lines';
import type { DoctorTab } from '../doctor/tabs';

import { DOCTOR_TABS } from '../doctor/tabs';

export { DOCTOR_TABS, type DoctorTab } from '../doctor/tabs';

/**
 * What the doctor's card shows. Filled only by `DoctorController`, which
 * plays the authority's doctor events back a beat at a time (a judgement,
 * then a heal, animals going home, tokens changing hands) before showing the
 * latest state, as the battle screen does. Svelte components read it and
 * never write it.
 *
 * The card has four tabs ([[UI_SPEC]] § Doctor): **heal** (the hurt animals),
 * **home** (set animals free, home to the wild, for tokens), **shop** (buy an
 * item with tokens) and **fly** (to another land, for a puzzle; only where
 * there is another land to list). `screen` says what the keyboard does: `list` moves the
 * cursor over the tab's rows (← → change the tab), `confirm` asks before a
 * hand-over, `offer` asks whether to take the surprise trip the witch doctor
 * offers (`surpriseLand`), `puzzle` types an answer (a healing puzzle or a
 * token sum), `busy` ignores everything but Escape while a beat plays.
 */
export type DoctorScreen = 'list' | 'confirm' | 'offer' | 'puzzle' | 'busy';

/** The token sum that is open: what it is for, and what changes hands. */
export type DoctorTrade =
	| { kind: 'home'; ids: readonly string[]; reward: number }
	| { kind: 'buy'; itemId: ItemId; price: number };

/**
 * A row of a tab's list. The animals come in their species' bundles (the
 * order each species first comes in the party, then party order within it),
 * since one healing puzzle helps a whole species; `groupStart` marks the
 * first row of a bundle after the first. On **home** a bundle of several
 * animals has a row of its own over them, `bundle` ("Fox ×40"), which picks
 * or unpicks the whole kind at once. `send` is Set free's button, and `bye`
 * ends every list.
 */
export type DoctorRow =
	| { kind: 'bundle'; speciesId: string; groupStart: boolean }
	| { kind: 'animal'; partyIndex: number; groupStart: boolean }
	| { kind: 'item'; itemId: ItemId }
	/** Another land, on the fly tab: a flight there, or (locked) why not yet. */
	| { kind: 'land'; land: LandId }
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
	/** The land the tent is in: what the shop's prices and the money are. */
	land = $state<LandId>(FIRST_LAND);
	/**
	 * The other lands the fly tab lists, in their order: every land this
	 * build flies to but this one, locked ones too (greyed: the card says how
	 * to unlock them). Empty: no fly tab.
	 */
	lands = $state<LandId[]>([]);
	/** The lands the kid has unlocked: where they may fly. */
	unlocked = $state<string[]>([]);
	/** The land whose fare is asked, while it is. */
	fare = $state<LandId | null>(null);
	/** What the doctor is saying, worded by the card in the language on screen. */
	line = $state<DoctorLine | null>(null);
	tab = $state<DoctorTab>('heal');
	/** Highlighted row: an index into the tab's rows (`tabRows`). */
	cursor = $state(0);
	/** The animals picked on the home tab to go home, by id. */
	marked = $state<string[]>([]);
	/** The land of the surprise trip offered, while it is. */
	offer = $state<LandId | null>(null);
	/**
	 * The two choices of the confirm before a hand-over (0 lights "No, keep
	 * them", 1 "Yes, bye bye!") and of the surprise trip (0 "Not now", 1 "Yes, let's fly!").
	 */
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
		this.land = FIRST_LAND;
		this.lands = [];
		this.unlocked = [];
		this.fare = null;
		this.offer = null;
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

/** The tabs the card shows: heal, set free and shop, and fly when there is another land to list. */
export function doctorTabs(lands: readonly LandId[]): DoctorTab[] {
	return DOCTOR_TABS.filter((tab) => tab !== 'fly' || lands.length > 0);
}

/** The rows of a tab's list, top to bottom. */
export function tabRows(
	tab: DoctorTab,
	party: readonly AnimalInstance[],
	shop: readonly ItemId[],
	lands: readonly LandId[] = []
): DoctorRow[] {
	if (tab === 'shop') {
		return [...shop.map((itemId) => ({ kind: 'item' as const, itemId })), { kind: 'bye' }];
	}
	if (tab === 'fly') {
		return [...lands.map((land) => ({ kind: 'land' as const, land })), { kind: 'bye' }];
	}
	const animals = bundles(party).flatMap((bundle, b): DoctorRow[] => {
		const head = tab === 'home' && bundle.animals.length > 1;
		const rows = bundle.slots.map((partyIndex, k): DoctorRow => ({
			kind: 'animal',
			partyIndex,
			groupStart: b > 0 && k === 0 && !head
		}));
		return head
			? [{ kind: 'bundle', speciesId: bundle.speciesId, groupStart: b > 0 }, ...rows]
			: rows;
	});
	return tab === 'home'
		? [...animals, { kind: 'send' }, { kind: 'bye' }]
		: [...animals, { kind: 'bye' }];
}

/**
 * The rows the cursor stops on: on **heal** the animals who need the doctor
 * (fit ones are shown, greyed, and skipped); on **home** every animal and
 * every bundle's row, and Set them free once one is picked; on **shop** every
 * item, the ones that can't be bought too (the card says why); and Bye on
 * every tab.
 */
export function rowStops(rows: readonly DoctorRow[], view: StopsView): number[] {
	return rows.flatMap((row, k) => {
		switch (row.kind) {
			case 'animal':
				return view.tab !== 'heal' || needsHealing(view.party[row.partyIndex]!) ? [k] : [];
			case 'send':
				return view.marked.length > 0 ? [k] : [];
			case 'bundle':
			case 'item':
			case 'land':
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

/** What `kindPicked` and `kindGoing` read. */
export interface PicksView {
	party: readonly AnimalInstance[];
	marked: readonly string[];
}

/**
 * The animals of a kind that go home once its row is picked: the ones
 * picked already and the ones a pick on the row adds (the engine's
 * `kindGoingHome`), in party order. All of the kind, but for the one who
 * stays when the kind is all that stands. Its row says what they bring, so
 * the number on the row is the number the sum adds.
 */
export function kindGoing(speciesId: string, view: PicksView): AnimalInstance[] {
	const going = new Set([...view.marked, ...kindGoingHome(view.party, view.marked, speciesId)]);
	return view.party.filter((a) => a.speciesId === speciesId && going.has(a.id));
}

/**
 * How much of a kind is picked to go home, for its bundle row's check box:
 * `none`; `all`, once every one of the kind that may go is picked (the one
 * who stays aside, when one must: the engine's `kindGoingHome` adds nobody
 * more); else `some`. A pick on the row adds the rest while it is `none` or
 * `some`, and takes the whole kind back while it is `all`.
 */
export function kindPicked(speciesId: string, view: PicksView): 'none' | 'some' | 'all' {
	const marked = new Set(view.marked);
	if (!view.party.some((a) => a.speciesId === speciesId && marked.has(a.id))) return 'none';
	return kindGoingHome(view.party, view.marked, speciesId).length === 0 ? 'all' : 'some';
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
