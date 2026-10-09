import {
	STARTERS,
	WorldEdits,
	bundles,
	checkName,
	getLand,
	hasItem,
	spawnPoint,
	landSeed,
	type Authority,
	type GameEvent,
	type LandId,
	type SavedGame
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { WORLD_SEED } from '../authority/local';
import { isLanguage, language, nextLanguage } from '../copy';
import { isShortcut, keyName } from '../input/keyboard';
import { isMashKey, PickGuard } from '../input/pick-guard';
import { tappedLanguage, tappedRow } from '../input/press';
import type { TitleView3D } from '../render/title-scenery';
import type { SaveNotice } from '../save/notices';
import {
	CONFIRM_CHOICES,
	title,
	type LoggedOut,
	type NameFor,
	type TitleRow
} from '../state/title.svelte';

/**
 * The title ([[UI_SPEC]] § Title): the menu (Continue, New game, the
 * settings), the confirm before a new game puts a saved one away, the
 * player's name box, the starters side by side, and the name box for the one
 * picked.
 *
 * Keys become cursor moves and, at the end, one intent: `new-game`, with
 * the starter, its name as typed and the player's name; the engine checks
 * the starter and cleans its name, and the title closes on the `welcome`
 * that answers it. Continue is the host's to do (`hooks.continueGame`): the
 * saved game is the client's, so the authority is handed it rather than
 * asked for it. A game saved before names asks the player's name first, and
 * Continue hands it on with the game.
 *
 * The player's name goes on only when the engine's `checkName` takes it; the
 * box says kindly why not (too short, only letters and numbers, another
 * name) and stays open.
 *
 * The screens that choose something for the game — the confirm, the name
 * boxes, the starters — take a pick only after a quiet moment
 * (`input/pick-guard.ts`), so a key mashed on the screen before can't choose
 * on this one unseen. The confirm starts on its safe choice, so even a
 * deliberate Enter needs a deliberate arrow first to start over. The menu
 * picks at once: Continue carries on, and New game asks first.
 *
 * A click or a tap is a key press too (`input/press.ts`): on the menu and
 * the confirm a row does its thing at once, as the arrows and Enter would,
 * behind the same guards (a tap on "Yes" is a deliberate choice, not a
 * mash); a language is its language key; a starter's tag only lights it,
 * since picking starts a game, and the card's button (Enter) picks.
 */

export interface TitleHooks {
	/**
	 * Continue: the authority picks up `game`, and saving begins. `name`: the
	 * player's name, given just now for a game saved without one; the host
	 * sends it on (`choose-name`) as soon as the game is under way.
	 */
	continueGame(game: SavedGame, name?: string): void;
	/** "I have an account → Log in": the account card, over the title. */
	logIn?(): void;
	/**
	 * Escape on a land's starters (a first arrival): talk to the druid
	 * the kid came down beside, who can fly them back.
	 */
	toDoctor?(): boolean;
	/** Whether a land's starters may come up now: exploring, with nothing else on screen. */
	starterRoom?(): boolean;
}

export class TitleController {
	/** The quiet moment the confirm, the name boxes and the starters wait for before a pick. */
	private guard = new PickGuard();
	/** `new-game` is sent and not answered yet: keys wait. */
	private sent = false;
	/**
	 * A first arrival in a land waits for its starter (`starter-wanted`):
	 * the land and its starters, until one is picked. The starters come up
	 * whenever nothing else is on screen (`watchLand`).
	 */
	private wanted: { land: LandId; starters: readonly string[] } | null = null;

	constructor(
		private authority: Authority,
		private scenery: TitleView3D,
		private hooks: TitleHooks
	) {}

	/**
	 * Show the title. `saved` is the game Continue picks up (null: there is
	 * none, and New game is the only way on); `notice`, what the title says
	 * about the save (this page cannot keep the game); `keeps`, whether this
	 * page keeps its game, so New game puts `saved` away; `loggedOut`, a
	 * logout just now: the title says the account's game is safe, and lights
	 * logging in to it again, the first row, as soon as the server lets it show.
	 */
	open(
		saved: SavedGame | null,
		notice: SaveNotice | null = null,
		keeps = true,
		loggedOut: LoggedOut | null = null
	): void {
		title.saved = saved;
		title.notice = notice;
		title.keeps = keeps;
		title.loggedOut = loggedOut;
		title.cursor = 0;
		title.confirm = 0;
		title.starter = 0;
		title.draft = '';
		title.nameDraft = '';
		title.nameFor = 'new';
		title.nameRefused = null;
		title.playerName = null;
		title.starters = STARTERS;
		title.land = null;
		title.open = true;
		this.sent = false;
		// After a logout the login row, when the server has let it show already; else the first
		// row, and the login row takes the cursor as it comes, unless the kid has moved it by then.
		this.toMenu(loggedOut ? 'login' : 'continue');
		title.awaited = loggedOut && title.rows[title.cursor] !== 'login' ? 'login' : null;
	}

	handle(event: GameEvent): void {
		// A game picked up or new: a `starter-wanted` after it says if it waits for one.
		if (event.type === 'welcome') this.wanted = null;
		switch (event.type) {
			case 'welcome':
				// A game started, picked up or new: the title's work is done.
				if (!title.open) return;
				title.open = false;
				this.sent = false;
				this.scenery.hide();
				break;
			case 'new-game-refused':
				// The screen offers only what the engine accepts; a refusal is a bug to see.
				console.warn(`new game refused: ${event.reason}`);
				this.sent = false;
				break;
			case 'starter-wanted':
				this.wanted = { land: event.land, starters: [...event.starters] };
				break;
			case 'starter-refused':
				console.warn(`starter refused: ${event.reason}`);
				this.sent = false;
				break;
			case 'party-changed':
				// The land's first animal is the kid's (or they flew back where they have some).
				if (event.party.length === 0) break;
				this.wanted = null;
				if (title.open && title.land !== null) this.closeLand();
				break;
			case 'game-left':
				this.wanted = null;
				break;
		}
	}

	/**
	 * Every frame: a first arrival waiting for its starter shows the land's
	 * starters whenever nothing else is on screen (the plane has gone, the
	 * druid's card is closed). The game under way stays as it is
	 * behind them.
	 */
	watchLand(): void {
		const wanted = this.wanted;
		if (!wanted || title.open || !(this.hooks.starterRoom?.() ?? false)) return;
		this.openLand(wanted.land, wanted.starters);
	}

	/** The land's starters side by side, over the game under way. */
	private openLand(land: LandId, starters: readonly string[]): void {
		title.saved = null;
		title.notice = null;
		title.loggedOut = null;
		title.awaited = null;
		title.draft = '';
		title.starters = starters;
		title.land = land;
		title.open = true;
		this.sent = false;
		this.toStarters(0);
	}

	/** Back to the game under way: the land's starter was picked, or the kid went to the druid. */
	private closeLand(): void {
		title.open = false;
		title.land = null;
		title.starters = STARTERS;
		this.sent = false;
		this.scenery.hide();
	}

	update(dt: number): void {
		if (!title.open) return;
		this.guard.tick(dt);
		const starters = title.screen === 'starter' || title.screen === 'naming';
		// The room the starter screen leaves the row (its card grows for the name box),
		// before the stage slides: the name tags then follow the animals in the same frame.
		if (starters) this.scenery.setRoom(title.room);
		this.scenery.update(dt);
		if (starters) {
			const spots = this.scenery.spots();
			if (!sameSpots(spots, title.spots)) title.spots = spots;
		}
	}

	onKey(e: KeyboardEvent): void {
		if (!title.open || this.sent) return;
		// An input method is still building a character; its Enter and Escape are its own.
		if (e.isComposing || e.keyCode === 229) return;
		if (title.screen === 'naming') {
			this.namingKey(e);
			return;
		}
		if (title.screen === 'player') {
			this.playerKey(e);
			return;
		}
		if (isShortcut(e)) return; // leave browser shortcuts alone
		// Never act on auto-repeat: a key held since the last screen must be pressed again.
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		// W A S D by where they sit, whatever the layout, and in capitals with Caps Lock on.
		const key = keyName(e);
		// Whether a pick may go now; a key a kid mashes starts the quiet moment again.
		const fresh = isMashKey(key) ? this.guard.press() : this.guard.ready;
		const handled =
			title.screen === 'menu'
				? this.menuKey(key)
				: title.screen === 'confirm'
					? this.confirmKey(key, fresh)
					: this.starterKey(key, fresh);
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private menuKey(key: string): boolean {
		// The kid has the menu in hand: no row takes the cursor from them as it comes.
		title.awaited = null;
		const rows = title.rows;
		const tapped = tappedRow(key);
		if (tapped !== undefined) {
			if (tapped >= rows.length) return true;
			title.cursor = tapped;
			return this.menuKey('Enter');
		}
		const code = tappedLanguage(key);
		if (code !== undefined) {
			title.cursor = Math.max(0, rows.indexOf('language'));
			if (isLanguage(code) && code !== language.current) {
				sfx.play('confirm');
				language.set(code);
			}
			return true;
		}
		const row = rows[title.cursor];
		switch (key) {
			case 'ArrowUp':
			case 'w':
				title.cursor = (title.cursor + rows.length - 1) % rows.length;
				sfx.play('move');
				return true;
			case 'ArrowDown':
			case 's':
				title.cursor = (title.cursor + 1) % rows.length;
				sfx.play('move');
				return true;
			case 'ArrowLeft':
			case 'a':
			case 'ArrowRight':
			case 'd': {
				// Left and right change the setting on its row, and do nothing elsewhere:
				// the next or previous language; sound off (left) or on (right).
				const right = key === 'ArrowRight' || key === 'd';
				if (row === 'language') {
					sfx.play('confirm');
					nextLanguage(right ? 1 : -1);
					return true;
				}
				if (row === 'sound') {
					if (sfx.on !== right) setSound(right);
					return true;
				}
				return false;
			}
			case 'Enter':
			case ' ':
				if (row) this.chooseRow(row);
				return true;
		}
		return false;
	}

	private chooseRow(row: TitleRow): void {
		switch (row) {
			case 'continue':
				sfx.play('confirm');
				if (!title.saved) break;
				// A game saved before names asks the player's name once, before it goes on.
				if (title.saved.name === null) this.toPlayerName('continue');
				else this.hooks.continueGame(title.saved);
				break;
			case 'new':
				sfx.play('confirm');
				// A saved game would be put away: ask first. Without one, straight to the name.
				if (title.saved) {
					title.screen = 'confirm';
					title.confirm = 0;
					this.guard.show();
				} else this.toPlayerName('new');
				break;
			case 'login':
				this.hooks.logIn?.();
				break;
			case 'language':
				sfx.play('confirm');
				nextLanguage(1);
				break;
			case 'sound':
				setSound(!sfx.on);
				break;
		}
	}

	private confirmKey(key: string, fresh: boolean): boolean {
		const tapped = tappedRow(key);
		if (tapped !== undefined) {
			// A tap on a choice picks it, so it waits the quiet moment as Enter does.
			if (tapped >= CONFIRM_CHOICES.length || !fresh) return true;
			title.confirm = tapped;
			return this.confirmKey('Enter', fresh);
		}
		switch (key) {
			case 'ArrowUp':
			case 'w':
				if (title.confirm !== 0) sfx.play('move');
				title.confirm = 0;
				return true;
			case 'ArrowDown':
			case 's':
				if (title.confirm !== 1) sfx.play('move');
				title.confirm = 1;
				return true;
			case 'Enter':
			case ' ':
				if (!fresh) return true;
				sfx.play('confirm');
				if (CONFIRM_CHOICES[title.confirm] === 'yes') this.toPlayerName('new');
				else this.toMenu('new');
				return true;
			case 'Escape':
				this.toMenu('new');
				return true;
		}
		return false;
	}

	private starterKey(key: string, fresh: boolean): boolean {
		const count = title.starters.length;
		const tapped = tappedRow(key);
		if (tapped !== undefined) {
			if (tapped < count && tapped !== title.starter) this.light(tapped);
			return true;
		}
		switch (key) {
			case 'ArrowLeft':
			case 'a':
			case 'ArrowUp':
			case 'w':
				this.light((title.starter + count - 1) % count);
				return true;
			case 'ArrowRight':
			case 'd':
			case 'ArrowDown':
			case 's':
				this.light((title.starter + 1) % count);
				return true;
			case 'Enter':
			case ' ':
				if (!fresh) return true;
				sfx.play('confirm');
				this.scenery.cheer(title.starter);
				title.draft = '';
				title.screen = 'naming';
				this.guard.show();
				return true;
			case 'Escape':
				// A land's starters: to the druid, who can fly the kid back; they come up
				// again once the card closes. A new game's: back to the name, as it was typed.
				if (title.land !== null) {
					// Only once his card is up: a kid not facing a tent keeps the starters.
					if (this.hooks.toDoctor?.()) {
						sfx.play('move');
						this.closeLand();
					}
				} else this.toPlayerName('new');
				return true;
		}
		return false;
	}

	/**
	 * The player's name box: every key but Enter, Escape and Tab types. Enter
	 * goes on once `checkName` takes the name (after the quiet moment, never on
	 * auto-repeat): to the starters, or into the saved game. A name it refuses
	 * stays in the box, with why.
	 */
	private playerKey(e: KeyboardEvent): void {
		// Paste, select all, Alt+Enter: the name box's and the browser's own.
		if (isShortcut(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			if (e.repeat || !this.guard.press()) return;
			const named = checkName(title.nameDraft);
			if (!named.ok) {
				title.nameRefused = named.reason;
				sfx.play('wrong');
				return;
			}
			title.nameRefused = null;
			title.nameDraft = named.name;
			title.playerName = named.name;
			sfx.play('confirm');
			if (title.nameFor === 'continue') {
				if (title.saved) this.hooks.continueGame(title.saved, named.name);
			} else this.toStarters(0);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (!e.repeat) this.toMenu(title.nameFor === 'continue' ? 'continue' : 'new');
		} else if (e.key === 'Tab') {
			e.preventDefault(); // the focus stays in the name box
		} else if (title.nameRefused !== null && (e.key.length === 1 || EDIT_KEYS.has(e.key))) {
			// Typing again, or rubbing out: the reason goes until the next try.
			title.nameRefused = null;
		}
	}

	private namingKey(e: KeyboardEvent): void {
		// Paste, select all, Alt+Enter: the name box's and the browser's own.
		if (isShortcut(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			// A held Enter, or one mashed through the pick, must not name the animal
			// unseen. Here Enter alone is the key a kid mashes: Space and the
			// numbers are letters of the name.
			if (e.repeat || !this.guard.press()) return;
			const speciesId = title.starters[title.starter];
			if (speciesId === undefined) return;
			this.sent = true;
			sfx.play('confirm');
			if (title.land !== null) {
				// A land's first animal: the game under way takes it (`party-changed` closes this).
				this.authority.dispatch({ type: 'pick-starter', speciesId, nickname: title.draft });
				return;
			}
			this.authority.dispatch({
				type: 'new-game',
				speciesId,
				nickname: title.draft,
				...(title.playerName === null ? {} : { name: title.playerName })
			});
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (!e.repeat) this.toStarters(title.starter);
		} else if (e.key === 'Tab') {
			e.preventDefault(); // the focus stays in the name box
		}
		// Anything else is typing, and the name box takes it.
	}

	// --- moves -----------------------------------------------------------------

	/** Back to the menu, the cursor on `row` (or the first row when it is not shown). */
	private toMenu(row: TitleRow): void {
		title.screen = 'menu';
		title.cursor = Math.max(0, title.rows.indexOf(row));
		this.showWorld();
	}

	/**
	 * The player's name box, over the title's world. `purpose`: where it leads.
	 * It holds the name given already, else the saved game's, else nothing.
	 */
	private toPlayerName(purpose: NameFor): void {
		// Back from the starters, the world comes back behind the box; from the menu it is there.
		const fromStage = title.screen === 'starter' || title.screen === 'naming';
		title.screen = 'player';
		title.nameFor = purpose;
		title.nameRefused = null;
		title.nameDraft = title.playerName ?? title.saved?.name ?? '';
		this.guard.show();
		if (fromStage) this.showWorld();
	}

	/** The world behind the menu: where the saved game stands, or World 1's spawn with the starters. */
	private showWorld(): void {
		const saved = title.saved;
		if (saved) {
			this.scenery.showWorld(
				landSeed(saved.land, saved.world),
				saved.pos,
				saved.facing,
				// One of each kind in the team, however many it holds: the scene stays light.
				bundles(saved.party).map((b) => b.speciesId),
				WorldEdits.decode(saved.edits),
				hasItem(saved, 'boat')
			);
		} else this.scenery.showWorld(WORLD_SEED, spawnPoint(WORLD_SEED), 'down', STARTERS);
	}

	/** The starters side by side, `index` lit. */
	private toStarters(index: number): void {
		title.screen = 'starter';
		title.starter = index;
		this.guard.show();
		// A land's starters stand on its own ground: The Arctic's on snow.
		const snowy = title.land !== null && getLand(title.land).look === 'warm-hat';
		this.scenery.showStarters(title.starters, snowy);
		this.scenery.select(index);
		title.spots = this.scenery.spots();
	}

	private light(index: number): void {
		title.starter = index;
		sfx.play('move');
		this.scenery.select(index);
	}
}

/** Keys that change what a name box holds without typing a letter. */
const EDIT_KEYS: ReadonlySet<string> = new Set(['Backspace', 'Delete']);

/** Turned on, the sound says so itself; turned off, only the switch does (as in the pause menu). */
function setSound(on: boolean): void {
	sfx.set(on);
	if (on) sfx.play('confirm');
}

function sameSpots(
	a: readonly { x: number; y: number }[],
	b: readonly { x: number; y: number }[]
): boolean {
	return (
		a.length === b.length &&
		a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-4 && Math.abs(p.y - b[i]!.y) < 1e-4)
	);
}
