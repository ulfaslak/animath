import type { BehindCause } from '../save/behind';

/**
 * The card that says this page is behind (see `save/behind.ts`): the page has
 * stopped taking play, and waits for the kid to come to it, or to ask for the
 * newest game. Written only by `main.ts`, each frame.
 */
class BehindView {
	/** The card is up. */
	shown = $state(false);
	/** Why the page is behind: another window played on, or something else. */
	cause = $state<BehindCause>('window');
	/** Reload into the newest game, as the kid asked (the card's button). Set by `main.ts`. */
	go: () => void = () => {};
}

export const behind = new BehindView();
