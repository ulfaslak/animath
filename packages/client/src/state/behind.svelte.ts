/**
 * Whether the card that says this window is behind another one is up (see
 * `save/behind.ts`): the page has stopped taking play, and waits for the kid
 * to come to it, or to press Enter. Written only by `main.ts`, each frame.
 */
class BehindView {
	shown = $state(false);
}

export const behind = new BehindView();
