import { LAND_IDS, availableLands, type LandId } from '@mathgame/engine';
import { flags } from '../flags';

/**
 * What the animal book shows besides the game's own record (`game.seen`,
 * `game.caught`) and the pause menu's cursor (`pause.option`, the lit card):
 * the figures' pictures drawn so far, and how the book's grid is laid out.
 */
class BookView {
	/**
	 * The picture of each species' figure, by id, as a PNG data URL, drawn
	 * with the game's renderer (`render/portraits.ts`) once the book is open,
	 * one a frame, for every species seen (`main.ts`). Kept for as long as the
	 * page lives: a species' figure never changes. An empty string is a
	 * figure that could not be drawn, and is not tried again.
	 */
	portraits = $state<Record<string, string>>({});
	/**
	 * How many cards a row of the book's grid holds as the screen lays them
	 * out now: `PauseMenu.svelte` measures it, and up and down go that far.
	 */
	columns = $state(6);
	/**
	 * Enter, Space or a tap on the lit card: its animal hops. Counts up, so
	 * each press hops once; `hopping` is the species that hops.
	 */
	hops = $state(0);
	hopping = $state<string | null>(null);
	/**
	 * The land whose page is open: a tab per land (#191), the land the kid
	 * is in when the book opens (`pause/controller.ts`).
	 */
	land = $state<LandId>('nordland');
	/** The cursor is on the land tabs over the cards, not on a card: up from the top row. */
	tabs = $state(false);
}

/**
 * The lands with a page in the book, in their order: every land the kid can
 * fly to (open to players in this build and unlocked by the kid), and the
 * land the kid is in (a throwaway game's `?lands` opens them all). A land
 * not built, or not unlocked yet, has no page, so the book never shows a kid
 * animals of a land they cannot go to (the witch doctor's Fly tab shows the
 * way to it); with one page, no tabs show.
 */
export function bookLands(here: LandId, unlocked: readonly string[]): LandId[] {
	if (flags.lands) return [...LAND_IDS];
	const open = availableLands();
	return LAND_IDS.filter((id) => (open.includes(id) && unlocked.includes(id)) || id === here);
}

export const book = new BookView();
