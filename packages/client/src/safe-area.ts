/**
 * The screen's safe area: how far a notch, rounded corners or the home
 * indicator reach in from each edge, in CSS pixels. `styles.css` has them as
 * `--safe-top`, `--safe-right`, `--safe-bottom` and `--safe-left` (the
 * browser's `env(safe-area-inset-*)`), and the overlay keeps what a kid reads
 * or taps inside them. Layout done in code that must agree with the overlay
 * (the battle scene's framing round the panel, the leash round the status
 * box, the party column's open card) reads them here. All 0 where the screen
 * has none, and outside a browser.
 */
export interface Insets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

/** A hidden box spanning the safe area, whose computed edges are the insets. */
let probe: HTMLElement | null = null;

export function safeArea(): Insets {
	if (typeof document === 'undefined' || !document.body) {
		return { top: 0, right: 0, bottom: 0, left: 0 };
	}
	if (!probe?.isConnected) {
		probe = document.createElement('div');
		probe.setAttribute('aria-hidden', 'true');
		probe.style.cssText =
			'position:fixed;visibility:hidden;pointer-events:none;' +
			'top:var(--safe-top);right:var(--safe-right);bottom:var(--safe-bottom);left:var(--safe-left)';
		document.body.append(probe);
	}
	const style = getComputedStyle(probe);
	const px = (value: string) => Number.parseFloat(value) || 0;
	return {
		top: px(style.top),
		right: px(style.right),
		bottom: px(style.bottom),
		left: px(style.left)
	};
}
