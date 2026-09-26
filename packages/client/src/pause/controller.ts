import type { Authority, GameEvent, PartyIntent } from '@mathgame/engine';
import { sfx } from '../audio/sfx.svelte';
import { isLanguage, language, nextLanguage } from '../copy';
import { isShortcut, keyName } from '../input/keyboard';
import { tappedLanguage, tappedRow } from '../input/press';
import { game } from '../state/game.svelte';
import {
	MENU_ITEMS,
	partyOptions,
	pause,
	type MenuItem,
	type PartyOption,
	type PartyOptionRow
} from '../state/pause.svelte';

/**
 * The pause menu, opened with Escape in explore: the team in battle order,
 * where an animal can be moved (which picks who goes first) or named, then
 * the settings (Language, Sound) and "Keep playing".
 *
 * Keys become menu moves and `party` intents; the menu then shows whatever
 * the authority's `party-edited` says, so a refused edit simply changes
 * nothing. `main.ts` sends keys here only in explore and switches explore
 * input off while the menu is open, so walking waits and W A S D typed into
 * the name box are letters, not steps.
 */
export class PauseController {
	constructor(private authority: Authority) {}

	handle(event: GameEvent): void {
		switch (event.type) {
			case 'welcome':
			case 'game-left':
			case 'battle-started':
			case 'doctor-visit-started':
				// Something else has the screen now; the menu never stays open under it.
				this.close();
				break;
			case 'party-edited':
				for (const e of event.events) {
					if (e.type === 'rejected') console.warn(`party intent rejected: ${e.reason}`);
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
		const handled = pause.screen === 'list' ? this.listKey(key) : this.optionsKey(key);
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
		const rows = game.party.length + MENU_ITEMS.length;
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
			pause.cursor = game.party.length + MENU_ITEMS.indexOf('language');
			if (isLanguage(code) && code !== language.current) language.set(code);
			return true;
		}
		const item = MENU_ITEMS[pause.cursor - game.party.length];
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
				const animal = game.party[pause.cursor];
				if (animal) {
					sfx.play('confirm');
					this.pick(animal.id);
				} else if (item) this.chooseItem(item);
				return true;
			}
			case 'ArrowLeft':
			case 'a':
			case 'ArrowRight':
			case 'd':
				// Left and right set the setting on its row, and do nothing elsewhere.
				return item !== undefined && this.settingKey(item, key === 'ArrowRight' || key === 'd');
			case 'Escape':
				this.close();
				return true;
		}
		return false;
	}

	private chooseItem(item: MenuItem): void {
		switch (item) {
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
			case 'resume':
			case 'quit':
				return false;
		}
	}

	/** Turned on, the sound says so itself; turned off, only the switch does. */
	private setSound(on: boolean): void {
		sfx.set(on);
		if (on) sfx.play('confirm');
	}

	private optionsKey(key: string): boolean {
		const index = this.pickedIndex();
		if (index < 0) {
			this.backToList();
			return true;
		}
		const options = partyOptions(game.party, index);
		// A tap on an option does it, as the arrows and Enter would; a greyed one does nothing.
		const row = tappedRow(key);
		if (row !== undefined) {
			if (!options[row]?.enabled) return true;
			pause.option = row;
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
				this.backToList();
				return true;
		}
		return false;
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
			this.backToList();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (!e.repeat) pause.screen = 'options';
		} else if (e.key === 'Tab') {
			e.preventDefault(); // the focus stays in the name box
		}
		// Anything else is typing, and the name box takes it.
	}

	private pick(animalId: string): void {
		pause.picked = animalId;
		pause.screen = 'options';
		const options = partyOptions(game.party, this.pickedIndex());
		pause.option = Math.max(
			0,
			options.findIndex((o) => o.enabled)
		);
	}

	private choose(option: PartyOption, index: number): void {
		const animal = game.party[index]!;
		switch (option) {
			case 'first':
				this.send({ type: 'select-lead', animalId: animal.id });
				this.backToList();
				break;
			case 'up':
				this.send({ type: 'reorder', animalId: animal.id, to: index - 1 });
				break;
			case 'down':
				this.send({ type: 'reorder', animalId: animal.id, to: index + 1 });
				break;
			case 'name':
				pause.draft = animal.nickname ?? '';
				pause.screen = 'naming';
				break;
			case 'back':
				this.backToList();
				break;
		}
	}

	/** Back to the team, with the cursor on the animal that was picked, wherever it is now. */
	private backToList(): void {
		const index = this.pickedIndex();
		pause.screen = 'list';
		pause.picked = null;
		if (index >= 0) pause.cursor = index;
		this.settle();
	}

	/** After the party changes under the menu: nothing may point past its end. */
	private settle(): void {
		if (!pause.open) return;
		if (pause.picked !== null && this.pickedIndex() < 0) {
			pause.picked = null;
			pause.screen = 'list';
		}
		pause.cursor = Math.min(pause.cursor, game.party.length + MENU_ITEMS.length - 1);
	}

	private pickedIndex(): number {
		return pause.picked === null ? -1 : game.party.findIndex((a) => a.id === pause.picked);
	}

	private send(intent: PartyIntent): void {
		this.authority.dispatch({ type: 'party', intent });
	}
}

/** The next option in `dir` that can be chosen, wrapping round; `from` when there is no other. */
function nextEnabled(options: readonly PartyOptionRow[], from: number, dir: 1 | -1): number {
	for (let i = 1; i <= options.length; i++) {
		const at = (from + dir * i + options.length * i) % options.length;
		if (options[at]!.enabled) return at;
	}
	return from;
}
