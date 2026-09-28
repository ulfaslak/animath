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
}

export const book = new BookView();
