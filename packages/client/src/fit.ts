/**
 * Fits what a card holds into the card, for an attachment
 * (`{@attach fit(steps)}`). `steps` are ever tighter looks, named in the
 * card's `data-fit` (`data-fit="close small"`) for its styles to read, and
 * taken one at a time only while what the card holds is still bigger than
 * the card. Measured, not guessed: laid out as designed first, each time its
 * words or its size change, so a card with room keeps its look and a crowded
 * one gives up only as much as it must.
 *
 * The card's size must not follow what it holds (a grid cell, a set height):
 * the steps change what it holds, and a card that grew with it would never
 * be too small. After the last step, what still does not fit stays as it is.
 */
export function fit(steps: readonly string[]): (card: HTMLElement) => () => void {
	return (card) => {
		const refit = () => {
			let taken = 0;
			delete card.dataset.fit;
			while (taken < steps.length && overflows(card)) {
				taken++;
				card.dataset.fit = steps.slice(0, taken).join(' ');
			}
		};
		// Its size: the screen, and whatever shares the room with it (the doctor's line over it).
		const size = new ResizeObserver(refit);
		size.observe(card);
		// Its words: a new screen, a language, a line that came or went. Not `data-fit`, the steps' own.
		const words = new MutationObserver(refit);
		words.observe(card, {
			subtree: true,
			childList: true,
			characterData: true,
			attributes: true,
			attributeFilter: ['class']
		});
		// The font: text laid out in a stand-in first is laid out again when Nunito arrives.
		document.fonts?.addEventListener('loadingdone', refit);
		refit();
		return () => {
			size.disconnect();
			words.disconnect();
			document.fonts?.removeEventListener('loadingdone', refit);
		};
	};
}

/** What the card holds reaches past its padding box, down or across. */
function overflows(card: HTMLElement): boolean {
	return card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1;
}
