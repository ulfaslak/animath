import {
	bookOrder,
	bundles,
	parseWorldNumber,
	type Authority,
	type GameEvent,
	type LandId,
	type PartyIntent
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { isLanguage, language, nextLanguage } from '../copy';
import { isShortcut, keyName } from '../input/keyboard';
import { tappedLand, tappedLanguage, tappedOption, tappedRow } from '../input/press';
import { book, bookLands } from '../state/book.svelte';
import { game } from '../state/game.svelte';
import { presence } from '../state/presence.svelte';
import {
	lineOf,
	WORLD_DIGITS,
	cardRows,
	menuItems,
	partyOptions,
	pause,
	worldRows,
	type BundleOption,
	type MenuItem,
	type PartyOption,
	type WorldOption
} from '../state/pause.svelte';

/** What the menu's rows hand to the rest of the page (`main.ts`). */
export interface PauseHooks {
	/** Takes a trip to another world; without it, the `travel` intent goes at once. */
	travel?: (world: number) => void;
	/** Goes to another player, by public id (the presence controller's). */
	goTo?: (pid: string) => void;
	/** "Make an account": the account card, with the game on screen (`AccountController`'s). */
	makeAccount?: () => void;
	/** "Log in": the account card, to log in. */
	logIn?: () => void;
	/** "Log out": saved, and the page starts again as a guest. */
	logOut?: () => void;
}

/**
 * The pause menu, opened with Escape in explore: the team's cards in battle
 * order (one per species), where a card can move up or down (which picks who
 * goes first) and its animals can go first, move within the card or get a
 * name; then Worlds, the settings (Language, Sound), and "Keep playing"
 * and "Start screen" side by side. A card of one animal is that animal: picking it opens the
 * animal's options, and its moves move the card. A card of several opens
 * its own screen on the right: its options, then its animals, each of which
 * opens its options.
 *
 * Keys become menu moves and `party` intents; the menu then shows whatever
 * the authority's `party-edited` says, so a refused edit simply changes
 * nothing. `main.ts` sends keys here only in explore and switches explore
 * input off while the menu is open, so walking waits and W A S D typed into
 * the name box are letters, not steps.
 *
 * The Worlds row opens the Worlds screen in the menu's place: digits (the
 * number pad's too) type a world's number, Backspace takes one back, and Go,
 * Go home or Back. Going closes the menu and hands the trip to `travel`
 * (`main.ts`: the travel transition, which sends the `travel` intent under
 * its cover); without it, the intent goes at once.
 *
 * "Who's here" lists the other players in this world on the right
 * (`presence.roster`); picking one closes the menu and goes to them
 * (`goTo`, the presence controller's: it asks the server where they are,
 * then the authority to put the player there).
 *
 * The animal book, the row on the menu's title line, opens in the menu's
 * place: a card for every species, lit one at a time. The arrows walk the
 * cards as they are laid out (`book.columns` to a row), a tap lights one,
 * Enter or a tap on the lit one makes its animal hop, and Escape or Back
 * goes back to the list, on the book's row. It changes nothing in the game:
 * what it shows is the authority's, from `welcome` and `book-changed`.
 */
export class PauseController {
	constructor(
		private authority: Authority,
		private readonly options: PauseHooks = {}
	) {}

	/** A trip to another world: the transition's, which sends `travel` under its cover, or at once. */
	private travel(world: number): void {
		if (this.options.travel) this.options.travel(world);
		else this.authority.dispatch({ type: 'travel', world });
	}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
			case 'game-left':
			case 'battle-started':
			case 'doctor-visit-started':
				// Something else has the screen now; the menu never stays open under it.
				this.close();
				break;
			case 'travelled':
				// This player went to another world: the kid should see where they are. Another
				// player's trip is none of this menu's business.
				if (event.playerId === game.playerId) this.close();
				break;
			case 'party-edited':
				// The menu greys what the engine would refuse, so a refusal while it is open
				// is a bug worth a word to developers. With it closed the edit came from
				// explore (a number key, a card), where a refusal is an answer the HUD words
				// ("Rabbit is tired"), not a bug (#59).
				if (pause.open) {
					for (const e of event.events) {
						if (e.type === 'rejected') console.warn(`party intent rejected: ${e.reason}`);
					}
				}
				this.settle();
				break;
			case 'party-changed':
				this.settle();
				break;
		}
	}

	onKey(e: KeyboardEvent): void {
		// An input method is still building a character; its Enter and Escape are its own.
		// Safari ends the composition before the Enter that commits it arrives, so
		// that keydown says `isComposing: false`; its keyCode is still 229.
		if (e.isComposing || e.keyCode === 229) return;
		if (!pause.open) {
			if (e.key === 'Escape' && !e.repeat && !isShortcut(e)) {
				this.open();
				e.preventDefault();
			}
			return;
		}
		// The name box takes letters as typed, so it reads the key itself.
		if (pause.screen === 'naming') {
			this.namingKey(e);
			return;
		}
		if (isShortcut(e)) return; // leave browser shortcuts alone
		// Never act on auto-repeat: an arrow still held from walking must not scroll the menu.
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		const key = keyName(e);
		const handled =
			pause.screen === 'list'
				? this.listKey(key)
				: pause.screen === 'bundle'
					? this.cardKey(key)
					: pause.screen === 'worlds'
						? this.worldsKey(key)
						: pause.screen === 'players'
							? this.playersKey(key)
							: pause.screen === 'book'
								? this.bookKey(key)
								: this.optionsKey(key);
		if (handled) e.preventDefault();
	}

	private open(): void {
		pause.reset();
		pause.open = true;
		sfx.play('confirm');
	}

	close(): void {
		pause.reset();
	}

	// --- screens -------------------------------------------------------------

	private listKey(key: string): boolean {
		const cards = bundles(game.party);
		const items = menuItems();
		const rows = cards.length + items.length;
		// A tap on a row does it at once, as the arrows and Enter would: nothing
		// here spends anything, and every move can be moved back.
		const row = tappedRow(key);
		if (row !== undefined) {
			if (row >= rows) return true;
			pause.cursor = row;
			return this.listKey('Enter');
		}
		// A tap on a language on the Language row: that language, whichever is on now.
		const code = tappedLanguage(key);
		if (code !== undefined) {
			pause.cursor = cards.length + items.indexOf('language');
			if (isLanguage(code) && code !== language.current) {
				sfx.play('confirm');
				language.set(code);
			}
			return true;
		}
		const item = items[pause.cursor - cards.length];
		switch (key) {
			case 'ArrowUp':
			case 'w':
				pause.cursor = (pause.cursor + rows - 1) % rows;
				sfx.play('move');
				return true;
			case 'ArrowDown':
			case 's':
				pause.cursor = (pause.cursor + 1) % rows;
				sfx.play('move');
				return true;
			case 'Enter':
			case ' ': {
				const card = cards[pause.cursor];
				if (card) {
					sfx.play('confirm');
					// A card of one animal is that animal; a card of several opens its own screen.
					if (card.animals.length === 1) this.pick(card.animals[0]!.id, null);
					else this.openCard(card.speciesId);
				} else if (item) this.chooseItem(item);
				return true;
			}
			case 'ArrowLeft':
			case 'a':
			case 'ArrowRight':
			case 'd': {
				const right = key === 'ArrowRight' || key === 'd';
				if (item === undefined) return false;
				// Left and right set the setting on its row, even where it shares its line.
				if (this.settingKey(item, right)) return true;
				// Rows side by side (Worlds and Who's here, the account's, Keep playing and Start
				// screen): left and right step between them. Elsewhere they do nothing.
				const line = lineOf(item, items);
				if (line.length < 2) return false;
				const at = line.indexOf(item);
				const to = line[Math.min(line.length - 1, Math.max(0, at + (right ? 1 : -1)))]!;
				if (to !== item) {
					pause.cursor = cards.length + items.indexOf(to);
					sfx.play('move');
				}
				return true;
			}
			case 'Escape':
				this.close();
				return true;
		}
		return false;
	}

	private chooseItem(item: MenuItem): void {
		switch (item) {
			case 'worlds':
				sfx.play('confirm');
				this.openWorlds();
				break;
			case 'players':
				sfx.play('confirm');
				pause.screen = 'players';
				pause.option = 0;
				break;
			case 'language':
				sfx.play('confirm');
				nextLanguage(1);
				break;
			case 'resume':
				this.close();
				break;
			case 'quit':
				// Back to the title: the authority stops the game, the autosave saves it as it
				// stands, and the title opens with it as Continue (`game-left`, in main.ts).
				sfx.play('confirm');
				this.close();
				this.authority.dispatch({ type: 'leave-game' });
				break;
			case 'sound':
				this.setSound(!sfx.on);
				break;
			case 'makeAccount':
				// The menu stays open under the card, and has the keys again when it goes.
				this.options.makeAccount?.();
				break;
			case 'logIn':
				this.options.logIn?.();
				break;
			case 'logOut':
				sfx.play('confirm');
				this.options.logOut?.();
				break;
			case 'book':
				sfx.play('confirm');
				pause.screen = 'book';
				pause.option = 0;
				// The page of the land the kid is in, its first card lit.
				book.land = game.land;
				book.tabs = false;
				break;
		}
	}

	/**
	 * Left or right on a setting's row: the next or previous language; sound
	 * off (left) or on (right). False on a row that is not a setting.
	 */
	private settingKey(item: MenuItem, right: boolean): boolean {
		switch (item) {
			case 'language':
				sfx.play('confirm');
				nextLanguage(right ? 1 : -1);
				return true;
			case 'sound':
				if (sfx.on !== right) this.setSound(right);
				return true;
			case 'makeAccount':
			case 'logIn':
			case 'logOut':
			case 'worlds':
			case 'players':
			case 'resume':
			case 'quit':
			case 'book':
				return false;
		}
	}

	/**
	 * The animal book, in the menu's place: one card lit, walked by the
	 * arrows as the cards are laid out, `book.columns` to a row. Left and
	 * right go card by card, on into the next row and back; up and down a
	 * row, and down onto the last card from above a short last row. At an
	 * edge they stay put, silently, but for up from the top row with more
	 * than one land's page, which lights the land tabs over the cards
	 * (`book.tabs`): there left and right open the land beside, at once, and
	 * down, Enter or Space go back to its first card. A tap on a tab opens
	 * its page, the tab lit. A tap on a card lights it; on the lit one, and
	 * Enter or Space, its animal hops (a card never met has no animal to
	 * hop). Nothing here changes the game.
	 */
	private bookKey(key: string): boolean {
		const lands = bookLands(game.land);
		const page = bookOrder(book.land);
		const count = page.length;
		const at = Math.min(pause.option, count - 1);
		const light = (to: number): boolean => {
			if (to !== at || book.tabs) {
				pause.option = to;
				book.tabs = false;
				sfx.play('move');
			}
			return true;
		};
		const open = (land: LandId | undefined): boolean => {
			if (land && land !== book.land) {
				book.land = land;
				pause.option = 0;
				sfx.play('move');
			}
			book.tabs = true;
			return true;
		};
		if (key === 'Escape') {
			this.backToList();
			return true;
		}
		const tappedTab = tappedLand(key);
		if (tappedTab !== undefined) return lands.includes(tappedTab) ? open(tappedTab) : true;
		const tapped = tappedOption(key);
		if (tapped !== undefined) {
			if (tapped >= count) return true;
			return tapped === at && !book.tabs ? this.bookKey('Enter') : light(tapped);
		}
		if (book.tabs) {
			const i = lands.indexOf(book.land);
			switch (key) {
				case 'ArrowLeft':
				case 'a':
					return open(lands[Math.max(0, i - 1)]);
				case 'ArrowRight':
				case 'd':
					return open(lands[Math.min(lands.length - 1, i + 1)]);
				case 'ArrowDown':
				case 's':
				case 'Enter':
				case ' ':
					return light(0);
				case 'ArrowUp':
				case 'w':
					return true;
			}
			return false;
		}
		const columns = Math.max(1, book.columns);
		switch (key) {
			case 'ArrowLeft':
			case 'a':
				return light(Math.max(0, at - 1));
			case 'ArrowRight':
			case 'd':
				return light(Math.min(count - 1, at + 1));
			case 'ArrowUp':
			case 'w':
				if (at - columns >= 0) return light(at - columns);
				// Up from the top row: the land tabs, where there is more than one land's page.
				if (lands.length > 1) {
					book.tabs = true;
					sfx.play('move');
				}
				return true;
			case 'ArrowDown':
			case 's': {
				if (at + columns < count) return light(at + columns);
				// Above a short last row, down still goes down: to its last card.
				const lastRow = Math.floor((count - 1) / columns);
				return light(Math.floor(at / columns) < lastRow ? count - 1 : at);
			}
			case 'Enter':
			case ' ': {
				const speciesId = page[at]!.id;
				if (game.seen.includes(speciesId)) {
					book.hopping = speciesId;
					book.hops += 1;
					sfx.play('confirm');
				}
				return true;
			}
		}
		return false;
	}

	/**
	 * Who's here, on the right: one row per other player in this world, the
	 * nearest first. Enter (or a tap on a row) goes to them: the menu closes
	 * and the presence controller takes it from there. The list changes as
	 * players come and go; the cursor stays on the list.
	 */
	private playersKey(key: string): boolean {
		// The team and the settings stay on screen beside the list, and a tap on one of
		// them does that row, as on the list.
		if (tappedRow(key) !== undefined || tappedLanguage(key) !== undefined) {
			this.backToList();
			return this.listKey(key);
		}
		const rows = presence.roster;
		const tapped = tappedOption(key);
		if (tapped !== undefined) {
			if (tapped >= rows.length) return true;
			pause.option = tapped;
			return this.playersKey('Enter');
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
				if (rows.length > 1) {
					pause.option = (pause.option + rows.length - 1) % rows.length;
					sfx.play('move');
				}
				return true;
			case 'ArrowDown':
			case 's':
				if (rows.length > 1) {
					pause.option = (pause.option + 1) % rows.length;
					sfx.play('move');
				}
				return true;
			case 'Enter':
			case ' ': {
				const player = rows[Math.min(pause.option, rows.length - 1)];
				if (!player) return true;
				sfx.play('confirm');
				this.close();
				this.options.goTo?.(player.pid);
				return true;
			}
			case 'Escape':
				this.backToList();
				pause.cursor = bundles(game.party).length + menuItems().indexOf('players');
				return true;
		}
		return false;
	}

	/** Turned on, the sound says so itself; turned off, only the switch does. */
	private setSound(on: boolean): void {
		sfx.set(on);
		if (on) sfx.play('confirm');
	}

	/** A card of several animals: its options, then its animals, one cursor over them all. */
	private cardKey(key: string): boolean {
		// The team and the settings stay on screen beside the card, and a tap on one of
		// them does that row, as on the list (as the options do).
		if (tappedRow(key) !== undefined || tappedLanguage(key) !== undefined) {
			this.backToList();
			return this.listKey(key);
		}
		const speciesId = pause.species;
		const rows = speciesId === null ? [] : cardRows(game.party, speciesId, game.realm);
		if (speciesId === null || rows.filter((r) => r.kind === 'animal').length < 2) {
			this.backToList();
			return true;
		}
		// A tap on a row does it, as the arrows and Enter would; a greyed one does nothing.
		const tapped = tappedOption(key);
		if (tapped !== undefined) {
			if (!rows[tapped]?.enabled) return true;
			pause.option = tapped;
			return this.cardKey('Enter');
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
				pause.option = nextEnabled(rows, pause.option, -1);
				sfx.play('move');
				return true;
			case 'ArrowDown':
			case 's':
				pause.option = nextEnabled(rows, pause.option, 1);
				sfx.play('move');
				return true;
			case 'Enter':
			case ' ': {
				// An option that has just become impossible (the card reached the top)
				// keeps the cursor and does nothing: mashing Enter can't overshoot.
				const row = rows[pause.option];
				if (!row?.enabled) return true;
				if (row.kind === 'animal') {
					sfx.play('confirm');
					this.pick(row.animal.id, speciesId);
				} else {
					// "Go first" is heard as the lead's own ding (`hud`), once it is true.
					if (row.id !== 'first') sfx.play('confirm');
					this.chooseCard(row.id, speciesId);
				}
				return true;
			}
			case 'Escape':
				this.backToList();
				return true;
		}
		return false;
	}

	private optionsKey(key: string): boolean {
		// The team and the settings stay on screen beside the options, and a tap on
		// one of them does that row, as on the list: the options close (as Escape
		// closes them), then the row is done. Never an option of the picked animal (#45).
		if (tappedRow(key) !== undefined || tappedLanguage(key) !== undefined) {
			this.backToList();
			return this.listKey(key);
		}
		const index = this.pickedIndex();
		if (index < 0) {
			this.backToList();
			return true;
		}
		const options = partyOptions(game.party, index, game.realm);
		// A tap on an option does it, as the arrows and Enter would; a greyed one does nothing.
		const tapped = tappedOption(key);
		if (tapped !== undefined) {
			if (!options[tapped]?.enabled) return true;
			pause.option = tapped;
			return this.optionsKey('Enter');
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
				pause.option = nextEnabled(options, pause.option, -1);
				sfx.play('move');
				return true;
			case 'ArrowDown':
			case 's':
				pause.option = nextEnabled(options, pause.option, 1);
				sfx.play('move');
				return true;
			case 'Enter':
			case ' ': {
				// An option that has just become impossible (the animal reached the
				// top) keeps the cursor and does nothing: mashing Enter can't overshoot.
				const option = options[pause.option];
				if (option?.enabled) {
					// "Go first" is heard as the lead's own ding (`hud`), once it is true.
					if (option.id !== 'first') sfx.play('confirm');
					this.choose(option.id, index);
				}
				return true;
			}
			case 'Escape':
				this.back();
				return true;
		}
		return false;
	}

	/**
	 * The Worlds screen, in the menu's place: the number typed, then Go, Go
	 * home and Back, one cursor over them. The pad's Go taps the Go row.
	 */
	private worldsKey(key: string): boolean {
		const rows = worldRows(pause.worldDraft, game.world, game.home);
		// A tap on a row does it, as the arrows and Enter would; a greyed one does nothing.
		const tapped = tappedOption(key);
		if (tapped !== undefined) {
			if (!rows[tapped]?.enabled) return true;
			pause.option = tapped;
			return this.worldsKey('Enter');
		}
		if (/^[0-9]$/.test(key)) {
			// A digit, from the keyboard or the pad: the number grows, to four digits; a fifth
			// does nothing, and leaves the cursor where it is. Typing is silent, as an answer's is.
			if (pause.worldDraft.length < WORLD_DIGITS) {
				pause.worldDraft += key;
				this.onGo();
			}
			return true;
		}
		switch (key) {
			case 'Backspace':
				// With nothing typed there is nothing to take back, and the cursor stays.
				if (pause.worldDraft !== '') {
					pause.worldDraft = pause.worldDraft.slice(0, -1);
					this.onGo();
				}
				return true;
			case 'ArrowUp':
			case 'w':
				pause.option = nextEnabled(rows, pause.option, -1);
				sfx.play('move');
				return true;
			case 'ArrowDown':
			case 's':
				pause.option = nextEnabled(rows, pause.option, 1);
				sfx.play('move');
				return true;
			case 'Enter':
			case ' ': {
				// Go with nothing to go to keeps the cursor and does nothing: mashing Enter
				// before the number is typed goes nowhere.
				const row = rows[pause.option];
				if (row?.enabled) this.chooseWorld(row.id);
				return true;
			}
			case 'Escape':
				this.backToList();
				return true;
		}
		return false;
	}

	/** The Worlds screen, nothing typed, the cursor on the first row that can be done. */
	private openWorlds(): void {
		pause.screen = 'worlds';
		pause.worldDraft = '';
		const rows = worldRows('', game.world, game.home);
		pause.option = Math.max(
			0,
			rows.findIndex((r) => r.enabled)
		);
	}

	/**
	 * After a digit or a Backspace: the cursor on Go, greyed until the number
	 * is a world to go to, so the Enter after a number goes there or does
	 * nothing, never Go home or Back.
	 */
	private onGo(): void {
		pause.option = 0;
	}

	private chooseWorld(option: WorldOption): void {
		switch (option) {
			case 'go': {
				const to = parseWorldNumber(pause.worldDraft);
				if (to === null) return;
				this.close();
				this.travel(to);
				break;
			}
			case 'home':
				this.close();
				this.travel(game.home);
				break;
			case 'back':
				sfx.play('confirm');
				this.backToList();
				break;
		}
	}

	private namingKey(e: KeyboardEvent): void {
		// Paste, select all, Alt+Enter: the name box's and the browser's own.
		if (isShortcut(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			// A held Enter that opened the box must not save it straight away.
			if (e.repeat) return;
			const animalId = pause.picked;
			if (animalId !== null && this.pickedIndex() >= 0) {
				this.send({ type: 'rename', animalId, nickname: pause.draft });
			}
			sfx.play('confirm');
			this.back();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (!e.repeat) pause.screen = 'options';
		} else if (e.key === 'Tab') {
			e.preventDefault(); // the focus stays in the name box
		}
		// Anything else is typing, and the name box takes it.
	}

	/** An animal's options, opened from the team (`species` null) or from its card's screen. */
	private pick(animalId: string, species: string | null): void {
		pause.picked = animalId;
		pause.species = species;
		pause.screen = 'options';
		const options = partyOptions(game.party, this.pickedIndex(), game.realm);
		pause.option = Math.max(
			0,
			options.findIndex((o) => o.enabled)
		);
	}

	/** The screen of a card of several animals, the cursor on `animalId`'s row when given. */
	private openCard(speciesId: string, animalId?: string): void {
		pause.screen = 'bundle';
		pause.species = speciesId;
		pause.picked = null;
		const rows = cardRows(game.party, speciesId, game.realm);
		const on = rows.findIndex((r) => r.kind === 'animal' && r.animal.id === animalId);
		pause.option =
			on >= 0
				? on
				: Math.max(
						0,
						rows.findIndex((r) => r.enabled)
					);
	}

	private chooseCard(option: BundleOption, speciesId: string): void {
		const place = bundles(game.party).findIndex((b) => b.speciesId === speciesId);
		switch (option) {
			case 'first':
				this.send({ type: 'lead-species', speciesId });
				this.backToList();
				break;
			case 'up':
				this.send({ type: 'move-species', speciesId, to: place - 1 });
				break;
			case 'down':
				this.send({ type: 'move-species', speciesId, to: place + 1 });
				break;
			case 'back':
				this.backToList();
				break;
		}
	}

	private choose(option: PartyOption, index: number): void {
		const animal = game.party[index]!;
		const list = bundles(game.party);
		const place = list.findIndex((b) => b.speciesId === animal.speciesId);
		// Alone on its card, an animal moves with its card; beside others of its kind, within it.
		const alone = list[place]!.animals.length === 1;
		switch (option) {
			case 'first':
				this.send({ type: 'select-lead', animalId: animal.id });
				this.backToList();
				break;
			case 'up':
			case 'down': {
				const by = option === 'up' ? -1 : 1;
				this.send(
					alone
						? { type: 'move-species', speciesId: animal.speciesId, to: place + by }
						: { type: 'reorder', animalId: animal.id, to: index + by }
				);
				break;
			}
			case 'name':
				pause.draft = animal.nickname ?? '';
				pause.screen = 'naming';
				break;
			case 'back':
				this.back();
				break;
		}
	}

	/** Back from an animal: to its card's screen when it came from one, else to the team. */
	private back(): void {
		const species = pause.species;
		const animalId = pause.picked ?? undefined;
		const kin = game.party.filter((a) => a.speciesId === species).length;
		if (species !== null && kin > 1) {
			this.openCard(species, animalId);
			this.settle();
		} else this.backToList();
	}

	/**
	 * Back to the team, with the cursor on the card that was open, wherever it
	 * is now; from the Worlds screen, on the Worlds row; from the animal book,
	 * on its row.
	 */
	private backToList(): void {
		const from = pause.screen;
		const species = pause.species ?? game.party[this.pickedIndex()]?.speciesId;
		pause.screen = 'list';
		pause.picked = null;
		pause.species = null;
		pause.worldDraft = '';
		const cards = bundles(game.party).length;
		const place = bundles(game.party).findIndex((b) => b.speciesId === species);
		if (from === 'worlds') pause.cursor = cards + menuItems().indexOf('worlds');
		else if (from === 'book') pause.cursor = cards + menuItems().indexOf('book');
		else if (place >= 0) pause.cursor = place;
		this.settle();
	}

	/** After the party changes under the menu: nothing may point past its end. */
	private settle(): void {
		if (!pause.open) return;
		if (pause.picked !== null && this.pickedIndex() < 0) {
			pause.picked = null;
			pause.species = null;
			pause.screen = 'list';
		}
		if (pause.screen === 'bundle') {
			const rows = pause.species === null ? [] : cardRows(game.party, pause.species, game.realm);
			if (rows.filter((r) => r.kind === 'animal').length < 2) {
				pause.species = null;
				pause.screen = 'list';
			} else pause.option = Math.min(pause.option, rows.length - 1);
		}
		pause.cursor = Math.min(pause.cursor, bundles(game.party).length + menuItems().length - 1);
	}

	private pickedIndex(): number {
		return pause.picked === null ? -1 : game.party.findIndex((a) => a.id === pause.picked);
	}

	private send(intent: PartyIntent): void {
		this.authority.dispatch({ type: 'party', intent });
	}
}

/** The next row in `dir` that can be chosen, wrapping round; `from` when there is no other. */
function nextEnabled(rows: readonly { enabled: boolean }[], from: number, dir: 1 | -1): number {
	for (let i = 1; i <= rows.length; i++) {
		const at = (from + dir * i + rows.length * i) % rows.length;
		if (rows[at]!.enabled) return at;
	}
	return from;
}
