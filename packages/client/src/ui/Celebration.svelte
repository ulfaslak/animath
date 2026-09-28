<script lang="ts">
	/**
	 * The result card's celebration ([[UI_SPEC]] § Battle mode, End), above
	 * its headline. `big`, for an animal that joined the team: its name in
	 * big letters, in the title's colours and rim, popping in one by one over
	 * a burst of warm rays that turns slowly, with the doctor's stars flying
	 * out from behind the letters. `small`, for a win: a few
	 * stars popping up off the top of the headline. Stars never cross a word.
	 * Decoration only: the headline says what happened, the name is read from
	 * it, and nothing here takes a click or a tap. With reduced motion the
	 * rays stand still, the letters fade in and the stars twinkle in place.
	 */
	let { kind, name = '' }: { kind: 'big' | 'small'; name?: string } = $props();
	/**
	 * The name's words, each its letters, numbered across the whole name so
	 * they pop in one after another and take the title's colours in turn. A
	 * space is never a letter of its own: a box holding only a space shrinks
	 * to nothing, and "Brown rat" read "Brownrat" (#135). The words stand
	 * apart as words in a line do, and a long name breaks between them.
	 */
	const words = $derived.by(() => {
		let i = 0;
		return name
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => Array.from(word).map((letter) => ({ letter, i: i++ })));
	});

	/** Where each star flies (px from the middle of the name), when it sets off (s), its colour. */
	const BIG = [
		{ dx: -150, dy: -34, d: 0.25, c: 'gold' },
		{ dx: 146, dy: -26, d: 0.3, c: 'coral' },
		{ dx: -96, dy: 30, d: 0.38, c: 'green' },
		{ dx: 104, dy: 36, d: 0.22, c: 'blue' },
		{ dx: -40, dy: -62, d: 0.44, c: 'coral' },
		{ dx: 48, dy: -58, d: 0.34, c: 'gold' },
		{ dx: -190, dy: 6, d: 0.5, c: 'blue' },
		{ dx: 186, dy: 12, d: 0.46, c: 'green' },
		{ dx: -130, dy: -84, d: 0.56, c: 'gold' },
		{ dx: 134, dy: -80, d: 0.6, c: 'coral' }
	];
	/** From the top edge of the headline, up and out: never over its words. */
	const SMALL = [
		{ dx: -120, dy: -34, d: 0.05, c: 'gold' },
		{ dx: 118, dy: -30, d: 0.1, c: 'coral' },
		{ dx: -60, dy: -48, d: 0.18, c: 'green' },
		{ dx: 64, dy: -46, d: 0.02, c: 'blue' },
		{ dx: -4, dy: -56, d: 0.24, c: 'gold' }
	];
	const stars = $derived(kind === 'big' ? BIG : SMALL);
</script>

<span class="celebration {kind}" aria-hidden="true">
	{#if kind === 'big'}
		<span class="burst"></span>
	{/if}
	<!-- Before the name, so the stars come out from behind its letters. -->
	<span class="stars">
		{#each stars as s, k (k)}
			<i class="star {s.c}" style="--dx: {s.dx}px; --dy: {s.dy}px; animation-delay: {s.d}s"></i>
		{/each}
	</span>
	{#if kind === 'big'}
		<span class="name">
			{#each words as word, w (w)}
				{#if w > 0}{' '}{/if}<span class="word"
					>{#each word as { letter, i } (i)}<span class="letter c{i % 5}" style="--i: {i}"
							>{letter}</span
						>{/each}</span
				>
			{/each}
		</span>
	{/if}
</span>

<style>
	.celebration {
		position: relative;
		display: block;
		pointer-events: none;
	}
	/* On the top edge of the headline just under it: no room of its own. */
	.celebration.small {
		height: 0;
		top: 4px;
	}

	/* Warm rays behind the name, spilling past the card's top edge, fading out at the rim. */
	.burst {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 320px;
		height: 320px;
		margin: -160px 0 0 -160px;
		border-radius: 50%;
		background: repeating-conic-gradient(
			color-mix(in srgb, var(--warn) 50%, transparent) 0deg 9deg,
			transparent 9deg 22.5deg
		);
		mask: radial-gradient(closest-side, #000 35%, transparent 100%);
		animation:
			burst-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both,
			turn 24s linear infinite;
	}

	/* The new friend's name: chunky letters in the title's colours, a cream rim, popping in. */
	.name {
		position: relative;
		display: block;
		font-weight: 800;
		font-size: clamp(52px, 10vh, 76px);
		line-height: 1.15;
		letter-spacing: 0.02em;
		margin-bottom: 4px;
	}
	.letter {
		display: inline-block;
		color: var(--letter-color);
		-webkit-text-stroke: 8px var(--panel-cream);
		paint-order: stroke fill;
		text-shadow: 0 6px 0 rgba(45, 42, 50, 0.18);
		animation:
			letter-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both,
			bob 2.6s ease-in-out infinite;
		animation-delay: calc(var(--i) * 0.07s + 0.15s), calc(var(--i) * -0.33s);
	}
	/*
	 * A word keeps its letters together: a long name breaks between its words,
	 * and inside a word only when the word alone is wider than the card.
	 */
	.word {
		display: inline-block;
	}
	/* The title's colours in turn, counted across the whole name. */
	.letter.c0 {
		--letter-color: var(--coral);
	}
	.letter.c1 {
		--letter-color: var(--accent);
	}
	.letter.c2 {
		--letter-color: var(--good);
	}
	.letter.c3 {
		--letter-color: var(--blue);
	}
	.letter.c4 {
		--letter-color: var(--warn);
	}

	/* The doctor's chunky four-pointed stars, flying out from the middle. */
	.stars {
		position: absolute;
		left: 50%;
		top: 50%;
	}
	.star {
		position: absolute;
		width: 26px;
		height: 26px;
		margin: -13px 0 0 -13px;
		clip-path: polygon(50% 0, 64% 36%, 100% 50%, 64% 64%, 50% 100%, 36% 64%, 0 50%, 36% 36%);
		opacity: 0;
		animation: fly 1.2s ease-out forwards;
	}
	.small .star {
		width: 20px;
		height: 20px;
		margin: -10px 0 0 -10px;
	}
	.star.gold {
		background: var(--warn);
	}
	.star.green {
		background: var(--good);
	}
	.star.coral {
		background: var(--coral);
	}
	.star.blue {
		background: var(--blue);
	}

	@keyframes burst-in {
		from {
			scale: 0.2;
			opacity: 0;
		}
		to {
			scale: 1;
			opacity: 1;
		}
	}
	@keyframes turn {
		to {
			rotate: 360deg;
		}
	}
	@keyframes letter-in {
		from {
			scale: 0;
		}
		to {
			scale: 1;
		}
	}
	@keyframes bob {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-5px);
		}
	}
	@keyframes fly {
		0% {
			opacity: 0;
			transform: translate(0, 0) scale(0.2) rotate(0deg);
		}
		25% {
			opacity: 1;
			transform: translate(calc(var(--dx) * 0.55), calc(var(--dy) * 0.55)) scale(1.15) rotate(45deg);
		}
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy)) scale(0.5) rotate(120deg);
		}
	}
	/* Less motion: the rays stand still, the letters fade in, the stars twinkle where they land. */
	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
	@keyframes twinkle {
		0%,
		100% {
			opacity: 0;
			transform: translate(var(--dx), var(--dy));
		}
		40% {
			opacity: 1;
			transform: translate(var(--dx), var(--dy));
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.burst {
			animation: fade-in 0.4s ease-out both;
		}
		.letter {
			animation: fade-in 0.4s ease-out both;
			animation-delay: 0.1s;
		}
		.star {
			animation-name: twinkle;
			animation-duration: 1.4s;
		}
	}
</style>
