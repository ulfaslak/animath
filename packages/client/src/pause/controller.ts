import type { Authority, GameEvent, PartyIntent } from '@mathgame/engine';
import { isShortcut, keyName } from '../input/keyboard';
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
 * where an animal can be moved (which picks who goes first) or named.
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
	}

	close(): void {
		pause.reset();
	}

	// --- screens -------------------------------------------------------------

	private listKey(key: string): boolean {
		const rows = game.party.length + MENU_ITEMS.length;
		switch (key) {
			case 'ArrowUp':
			case 'w':
				pause.cursor = (pause.cursor + rows - 1) % rows;
				return true;
			case 'ArrowDown':
			case 's':
				pause.cursor = (pause.cursor + 1) % rows;
				return true;
			case 'Enter':
			case ' ': {
				const animal = game.party[pause.cursor];
				if (animal) this.pick(animal.id);
				else this.chooseItem(MENU_ITEMS[pause.cursor - game.party.length]!);
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
			case 'resume':
				this.close();
				break;
		}
	}

	private optionsKey(key: string): boolean {
		const index = this.pickedIndex();
		if (index < 0) {
			this.backToList();
			return true;
		}
		const options = partyOptions(game.party, index);
		switch (key) {
			case 'ArrowUp':
			case 'w':
				pause.option = nextEnabled(options, pause.option, -1);
				return true;
			case 'ArrowDown':
			case 's':
				pause.option = nextEnabled(options, pause.option, 1);
				return true;
			case 'Enter':
			case ' ': {
				// An option that has just become impossible (the animal reached the
				// top) keeps the cursor and does nothing: mashing Enter can't overshoot.
				const option = options[pause.option];
				if (option?.enabled) this.choose(option.id, index);
				return true;
			}
			case 'Escape':
				this.backToList();
				return true;
		}
		return false;
	}

	private namingKey(e: KeyboardEvent): void {
		if (e.ctrlKey || e.metaKey) return; // paste, select all: the name box's own
		if (e.key === 'Enter') {
			e.preventDefault();
			// A held Enter that opened the box must not save it straight away.
			if (e.repeat) return;
			const animalId = pause.picked;
			if (animalId !== null && this.pickedIndex() >= 0) {
				this.send({ type: 'rename', animalId, nickname: pause.draft });
			}
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
