<script lang="ts">
	import type { Direction } from '@mathgame/engine';
	import { onDestroy } from 'svelte';
	import { t } from '../copy';
	import { ARROW_KEYS, padDirection } from '../input/dpad';
	import { hold, press, release, unfocusable } from '../input/press';
	import { hud } from '../state/hud.svelte';

	/**
	 * The touch controls in explore (UI_SPEC § Touch): the D-pad in the bottom
	 * left corner and the Talk and Menu buttons in the bottom right, where the
	 * thumbs of a kid holding a tablet rest. Each is a key (`input/press.ts`):
	 * an arrow held down while the finger stays, Enter, Escape. So walking
	 * holds, taps and stops exactly as the arrow keys do, and a finger still
	 * down when a battle, the doctor or the menu takes the screen lets go
	 * there: this component goes, and explore drops held keys meanwhile.
	 */

	/** How far from the D-pad's centre, as a share of its width, a finger starts to press an arrow. */
	const DEAD_ZONE = 0.12;
	const ARROWS: readonly { dir: Direction; glyph: string }[] = [
		{ dir: 'up', glyph: '▲' },
		{ dir: 'left', glyph: '◀' },
		{ dir: 'right', glyph: '▶' },
		{ dir: 'down', glyph: '▼' }
	];

	/** The arrow held down now, if any. */
	let held = $state<Direction | null>(null);
	/** The one finger that steers; others on the pad are ignored. */
	let steering: number | null = null;

	function steer(dir: Direction | null): void {
		if (dir === held) return;
		if (held) release(ARROW_KEYS[held]);
		held = dir;
		if (dir) hold(ARROW_KEYS[dir]);
	}

	function aim(e: PointerEvent): Direction | null {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const dx = e.clientX - (box.left + box.width / 2);
		const dy = e.clientY - (box.top + box.height / 2);
		return padDirection(dx, dy, box.width * DEAD_ZONE);
	}

	function down(e: PointerEvent): void {
		if (steering !== null || e.button !== 0) return;
		steering = e.pointerId;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		steer(aim(e));
	}

	function move(e: PointerEvent): void {
		if (e.pointerId === steering) steer(aim(e));
	}

	function up(e: PointerEvent): void {
		if (e.pointerId !== steering) return;
		steering = null;
		steer(null);
	}

	/** An arrow pressed without a pointer (a screen reader's click) takes one step. */
	function click(dir: Direction) {
		return (e: MouseEvent) => {
			if (e.detail === 0) press(ARROW_KEYS[dir]);
		};
	}

	// The screen is changing (a battle, the doctor, the menu): let go of the arrow.
	onDestroy(() => steer(null));
</script>

<div
	class="dpad"
	role="group"
	onpointerdown={down}
	onpointermove={move}
	onpointerup={up}
	onpointercancel={up}
	onlostpointercapture={up}
>
	{#each ARROWS as arrow (arrow.dir)}
		<button
			type="button"
			class="arrow {arrow.dir}"
			class:on={held === arrow.dir}
			aria-label={arrow.dir === 'up'
				? t('explore.walkUp')
				: arrow.dir === 'down'
					? t('explore.walkDown')
					: arrow.dir === 'left'
						? t('explore.walkLeft')
						: t('explore.walkRight')}
			onclick={click(arrow.dir)}
			{@attach unfocusable}>{arrow.glyph}</button
		>
	{/each}
	<span class="hub"></span>
</div>

<button
	type="button"
	class="round menu-button"
	onclick={() => press('Escape')}
	{@attach unfocusable}
>
	<span class="bars" aria-hidden="true"><span></span><span></span><span></span></span>
	{t('hud.menu')}
</button>

<button
	type="button"
	class="round talk-button"
	class:ready={hud.facingTent}
	onclick={() => press('Enter')}
	{@attach unfocusable}
>
	{t('explore.talk')}
</button>

<style>
	.dpad {
		position: absolute;
		left: 20px;
		bottom: 20px;
		width: calc(var(--tap) * 4);
		height: calc(var(--tap) * 4);
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-template-rows: repeat(3, 1fr);
		touch-action: none;
	}
	.arrow {
		display: grid;
		place-items: center;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-size: 24px;
		color: var(--panel-ink);
		opacity: 0.92;
	}
	.arrow.on {
		background: var(--accent);
		color: white;
	}
	.up {
		grid-area: 1 / 2;
		border-radius: var(--radius) var(--radius) 4px 4px;
	}
	.left {
		grid-area: 2 / 1;
		border-radius: var(--radius) 4px 4px var(--radius);
	}
	.right {
		grid-area: 2 / 3;
		border-radius: 4px var(--radius) var(--radius) 4px;
	}
	.down {
		grid-area: 3 / 2;
		border-radius: 4px 4px var(--radius) var(--radius);
	}
	/* The centre joins the arms into one cross; a finger resting there presses nothing. */
	.hub {
		grid-area: 2 / 2;
		background: var(--panel-bg);
		pointer-events: none;
	}

	.round {
		position: absolute;
		display: grid;
		place-items: center;
		align-content: center;
		border-radius: 50%;
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		font-size: 18px;
		touch-action: manipulation;
	}
	.round:active {
		transform: scale(0.95);
	}
	.talk-button {
		right: 24px;
		bottom: 56px;
		width: calc(var(--tap) * 2);
		height: calc(var(--tap) * 2);
		font-size: 20px;
	}
	/* Facing a tent: Talk is what to press, so it lights up (the prompt says so in words too). */
	.talk-button.ready {
		background: var(--accent);
		color: white;
		animation: glow 1.6s ease-in-out infinite;
	}
	.menu-button {
		right: calc(24px + var(--tap) * 2 + 12px);
		bottom: 20px;
		width: calc(var(--tap) * 1.5);
		height: calc(var(--tap) * 1.5);
		gap: 3px;
		font-size: 16px;
	}
	.bars {
		display: grid;
		gap: 3px;
	}
	.bars span {
		display: block;
		width: 20px;
		height: 3px;
		border-radius: 2px;
		background: currentColor;
	}

	@keyframes glow {
		0%,
		100% {
			box-shadow:
				0 0 0 0 color-mix(in srgb, var(--accent) 60%, transparent),
				var(--hud-shadow);
		}
		50% {
			box-shadow:
				0 0 0 10px color-mix(in srgb, var(--accent) 0%, transparent),
				var(--hud-shadow);
		}
	}
</style>
