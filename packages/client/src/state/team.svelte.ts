/**
 * The explore HUD's party column: which card shows its animals on a touch
 * screen. A tap on a card of several animals opens it (`open:<speciesId>`,
 * which the explore controller turns into `toggle`); a tap on it again, a
 * step, or choosing who goes first from it closes it. With a mouse, pointing
 * at a card shows its animals instead, which is the HUD's own business. The
 * HUD closes it whenever it leaves the screen.
 */
class TeamView {
	/** The species whose card is open, or null. */
	open = $state<string | null>(null);

	toggle(speciesId: string): void {
		this.open = this.open === speciesId ? null : speciesId;
	}

	close(): void {
		this.open = null;
	}
}

export const team = new TeamView();
