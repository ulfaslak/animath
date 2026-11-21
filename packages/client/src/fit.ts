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
		// Its outer size, which the steps never change: a step's padding changes its content box,
		// and watching that fed each refit back into another.
		const size = new ResizeObserver(refit);
		size.observe(card, { box: 'border-box' });
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

/** More than this past the card's padding box is past it: `scripts/doctor-fit.mjs` measures the same. */
const TOLERANCE = 0.5;

/**
 * What the card holds reaches past its padding box, on any side. Its scroll
 * size is a whole number of pixels and says nothing of what a centred card
 * holds up past its top or left of its left side, so each piece it holds is
 * measured too, to a fraction of a pixel: by the scroll size alone, Hint sat
 * 1.1 px past a druid's card on a phone (#250).
 */
function overflows(card: HTMLElement): boolean {
	if (card.scrollHeight > card.clientHeight + 1 || card.scrollWidth > card.clientWidth + 1)
		return true;
	const box = card.getBoundingClientRect();
	const style = getComputedStyle(card);
	const left = box.left + parseFloat(style.borderLeftWidth) - TOLERANCE;
	const right = box.right - parseFloat(style.borderRightWidth) + TOLERANCE;
	const top = box.top + parseFloat(style.borderTopWidth) - TOLERANCE;
	const bottom = box.bottom - parseFloat(style.borderBottomWidth) + TOLERANCE;
	for (const piece of card.querySelectorAll('*')) {
		const r = piece.getBoundingClientRect();
		if (r.width < TOLERANCE && r.height < TOLERANCE) continue; // not drawn
		if (r.left < left || r.right > right || r.top < top || r.bottom > bottom) return true;
	}
	return false;
}
