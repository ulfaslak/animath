import {
	STARTERS,
	spawnPoint,
	type Authority,
	type GameEvent,
	type SavedGame
} from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { WORLD_SEED } from '../authority/local';
import { isLanguage, language, nextLanguage } from '../copy';
import { isShortcut, keyName } from '../input/keyboard';
import { tappedLanguage, tappedRow } from '../input/press';
import type { TitleView3D } from '../render/title-scenery';
import type { SaveNotice } from '../save/notices';
import { CONFIRM_CHOICES, title, type TitleRow } from '../state/title.svelte';

/**
 * The title ([[UI_SPEC]] § Title): the menu (Continue, New game, the
 * settings), the confirm before a new game puts a saved one away, the
 * starters side by side, and the name box for the one picked.
 *
 * Keys become cursor moves and, at the end, one intent: `new-game`, with
 * the starter and the name as typed; the engine checks the starter and
 * cleans the name, and the title closes on the `welcome` that answers it.
 * Continue is the host's to do (`hooks.continueGame`): the saved game is the
 * client's, so the authority is handed it rather than asked for it.
 *
 * Screens that choose something ignore Enter and Space for a moment after
 * they open, counted in frame time like the battle's result card, so a key
 * mashed on the screen before can't choose on this one unseen. The confirm
 * starts on its safe choice, so however Enter is mashed, a new game needs a
 * deliberate arrow first.
 *
 * A click or a tap is a key press too (`input/press.ts`): on the menu and
 * the confirm a row does its thing at once, as the arrows and Enter would,
 * behind the same guards (a tap on "Yes" is a deliberate choice, not a
 * mash); a language is its language key; a starter's tag only lights it,
 * since picking starts a game, and the card's button (Enter) picks.
 */

/** Frame seconds the confirm ignores Enter and Space after it opens. */
export const CONFIRM_GUARD_SECONDS = 0.8;
/** Frame seconds the starter screen, and then the name box, ignore Enter (and Space) after opening. */
export const PICK_GUARD_SECONDS = 0.5;

export interface TitleHooks {
	/** Continue: the authority picks up `game`, and saving begins. */
	continueGame(game: SavedGame): void;
}

export class TitleController {
	/** Frame seconds since the screen on show opened. */
	private age = 0;
	/** `new-game` is sent and not answered yet: keys wait. */
	private sent = false;

	constructor(
		private authority: Authority,
		private scenery: TitleView3D,
		private hooks: TitleHooks
	) {}

	/**
	 * Show the title. `saved` is the game Continue picks up (null: there is
	 * none, and New game is the only way on); `notice`, what start-up found
	 * about the save when the title should say it.
	 */
	open(saved: SavedGame | null, notice: SaveNotice | null = null): void {
		title.saved = saved;
		title.notice = notice;
		title.cursor = 0;
		title.confirm = 0;
		title.starter = 0;
		title.draft = '';
		title.open = true;
		this.sent = false;
		this.toMenu('continue');
	}

	handle(event: GameEvent): void {
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
		}
	}

	update(dt: number): void {
		if (!title.open) return;
		this.age += dt;
		this.scenery.update(dt);
		if (title.screen === 'starter' || title.screen === 'naming') {
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
		if (isShortcut(e)) return; // leave browser shortcuts alone
		// Never act on auto-repeat: a key held since the last screen must be pressed again.
		if (e.repeat) {
			e.preventDefault();
			return;
		}
		// W A S D by where they sit, whatever the layout, and in capitals with Caps Lock on.
		const key = keyName(e);
		const handled =
			title.screen === 'menu'
				? this.menuKey(key)
				: title.screen === 'confirm'
					? this.confirmKey(key)
					: this.starterKey(key);
		if (handled) e.preventDefault();
	}

	// --- screens -------------------------------------------------------------

	private menuKey(key: string): boolean {
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
				if (title.saved) this.hooks.continueGame(title.saved);
				break;
			case 'new':
				sfx.play('confirm');
				// A saved game would be put away: ask first. Without one, straight to the starters.
				if (title.saved) {
					title.screen = 'confirm';
					title.confirm = 0;
					this.age = 0;
				} else this.toStarters(0);
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

	private confirmKey(key: string): boolean {
		const tapped = tappedRow(key);
		if (tapped !== undefined) {
			if (tapped >= CONFIRM_CHOICES.length) return true;
			title.confirm = tapped;
			return this.confirmKey('Enter');
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
				if (this.age < CONFIRM_GUARD_SECONDS) return true;
				sfx.play('confirm');
				if (CONFIRM_CHOICES[title.confirm] === 'yes') this.toStarters(0);
				else this.toMenu('new');
				return true;
			case 'Escape':
				this.toMenu('new');
				return true;
		}
		return false;
	}

	private starterKey(key: string): boolean {
		const count = STARTERS.length;
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
				if (this.age < PICK_GUARD_SECONDS) return true;
				sfx.play('confirm');
				this.scenery.cheer(title.starter);
				title.draft = '';
				title.screen = 'naming';
				this.age = 0;
				return true;
			case 'Escape':
				this.toMenu('new');
				return true;
		}
		return false;
	}

	private namingKey(e: KeyboardEvent): void {
		// Paste, select all, Alt+Enter: the name box's and the browser's own.
		if (isShortcut(e)) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			// A held Enter, or one mashed through the pick, must not name the animal unseen.
			if (e.repeat || this.age < PICK_GUARD_SECONDS) return;
			const speciesId = STARTERS[title.starter];
			if (speciesId === undefined) return;
			this.sent = true;
			sfx.play('confirm');
			this.authority.dispatch({ type: 'new-game', speciesId, nickname: title.draft });
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
		this.age = 0;
		const saved = title.saved;
		if (saved) {
			this.scenery.showWorld(
				saved.seed,
				saved.pos,
				saved.facing,
				saved.party.map((a) => a.speciesId)
			);
		} else this.scenery.showWorld(WORLD_SEED, spawnPoint(WORLD_SEED), 'down', STARTERS);
	}

	/** The starters side by side, `index` lit. */
	private toStarters(index: number): void {
		title.screen = 'starter';
		title.starter = index;
		this.age = 0;
		this.scenery.showStarters(STARTERS);
		this.scenery.select(index);
		title.spots = this.scenery.spots();
	}

	private light(index: number): void {
		title.starter = index;
		sfx.play('move');
		this.scenery.select(index);
	}
}

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
