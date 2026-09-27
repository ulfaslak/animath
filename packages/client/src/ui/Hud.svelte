<script lang="ts">
	import { bundles, isItemId, leadIndex, type Bundle } from '@mathgame/engine';
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { t } from '../copy';
	import { flags } from '../flags';
	import {
		HOLD_MS,
		carriedBy,
		dragPhase,
		edgeSpeed,
		landing,
		shiftOf,
		type Column,
		type DragPhase,
		type Pointer
	} from '../input/drag';
	import { animalKey, bundleKey, moveKey, openKey, press, unfocusable } from '../input/press';
	import { itemName } from '../items';
	import { touch } from '../input/touch.svelte';
	import { motion } from '../motion';
	import { safeArea } from '../safe-area';
	import { game } from '../state/game.svelte';
	import { hud } from '../state/hud.svelte';
	import { team } from '../state/team.svelte';
	import BundleAnimals from './BundleAnimals.svelte';
	import BundleCard from './BundleCard.svelte';
	import Coin from './Coin.svelte';
	import ItemIcon from './ItemIcon.svelte';
	import Tick from './Tick.svelte';

	/**
	 * The explore HUD. The party column: one card per species, in battle
	 * order (`BundleCard`; the party is kept in bundles), a card of several
	 * animals a stack. The lead — the engine's `leadIndex`, the first animal
	 * standing, the one a battle sends out — marks its card "goes first".
	 * Under the cards, the keys for choosing and for the menu; at the bottom,
	 * the message line (`state/hud.svelte.ts`), which also says who goes first
	 * after a party edit.
	 *
	 * The column scrolls when it is taller than the screen allows. A stack's
	 * animals, each with its name and HP, show beside it (`BundleAnimals`)
	 * while a mouse points at it, and while it is open: a click or a tap on
	 * it opens and closes it (`open:<species>`, `state/team.svelte.ts`). A
	 * card of one animal is that animal's key instead (`bundle:<species>`),
	 * and an animal beside an open card is its own (`animal:<id>`): either
	 * goes first. The number keys pick the first nine cards.
	 *
	 * A card is dragged up or down the column to another place: with a mouse
	 * once it moves, with a finger once it has held still for a moment and
	 * then moves (moving first scrolls the column); a press that never moved
	 * is a tap, however long it rested (`input/drag.ts`). Carried to the
	 * column's top or bottom edge, the card keeps the column scrolling while it
	 * is held there. Dropped, it is the key `move:<species>:<to>`
	 * (`input/press.ts`), which the explore controller sends as
	 * `move-species`; until the party comes back in its new order the cards
	 * stay where the drop left them. Every action is a key press, so a pointer
	 * goes through the same screen and guards a key does.
	 *
	 * At the top right, the puzzles the player has solved beside their
	 * tokens, under them the tools they own, each with its name, and the
	 * world they are in.
	 */
	const list = $derived(bundles(game.party));
	const leadId = $derived(game.party[leadIndex(game.party, game.realm)]?.id ?? null);
	/** With one card there is nobody to choose between: no numbers, no tag, nothing to drag. */
	const choosing = $derived(list.length > 1);
	/** Some card holds several animals, which open to show them. */
	const stacks = $derived(list.some((b) => b.animals.length > 1));
	/** The number keys 1 to 9 reach the first nine cards. */
	const KEYS = 9;
	/** The cards' order, to see when a dropped card has landed. */
	const order = $derived(list.map((b) => b.speciesId).join());
	/** The tools owned, in the order bought; an id this build doesn't know shows nothing. */
	const tools = $derived(game.items.filter(isItemId));

	/** What a click or a tap on a card presses: open a stack, or choose its one animal. */
	function cardKey(bundle: Bundle): string | null {
		if (bundle.animals.length > 1) return openKey(bundle.speciesId);
		return choosing ? bundleKey(bundle.speciesId) : null;
	}

	// --- the open card ----------------------------------------------------------

	/** The stack a mouse points at, if any. */
	let hovered = $state<string | null>(null);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	/** The stack whose animals show: the one opened, else the one pointed at; none while a card is lifted. */
	const shown = $derived.by(() => {
		if (drag && drag.phase !== 'pressed') return null;
		const id = team.open ?? hovered;
		return list.find((b) => b.speciesId === id && b.animals.length > 1) ?? null;
	});

	function pointAt(e: PointerEvent, speciesId: string) {
		if (e.pointerType !== 'mouse' || drag) return;
		clearTimeout(hideTimer);
		hovered = speciesId;
	}

	function pointAway(e: PointerEvent) {
		if (e.pointerType !== 'mouse') return;
		clearTimeout(hideTimer);
		// Time for the pointer to cross the gap to the animals beside the card.
		hideTimer = setTimeout(() => (hovered = null), 160);
	}

	function pointAtAnimals(e: PointerEvent) {
		if (e.pointerType === 'mouse') clearTimeout(hideTimer);
	}

	let root = $state<HTMLElement>();
	let column = $state<HTMLElement>();
	/** Where the open card's animals stand, beside the column, top-aligned with the card. */
	let fanAt = $state<{ top: number; left: number; height: number } | null>(null);

	function placeAnimals(): void {
		const card = shown && column?.querySelector<HTMLElement>(`[data-species="${shown.speciesId}"]`);
		if (!card || !root || !column) {
			fanAt = null;
			return;
		}
		const base = root.getBoundingClientRect();
		const box = card.getBoundingClientRect();
		// Clear of the message line at the bottom of the screen, above the safe area.
		const bottom = window.innerHeight - safeArea().bottom - 84;
		// Beside the card when there is room for a few rows below it, else as low as fits.
		const want = Math.min(bottom - 16, 280);
		const top = bottom - box.top >= want ? box.top : bottom - want;
		fanAt = {
			top: top - base.top,
			left: column.getBoundingClientRect().right - base.left + 4,
			height: bottom - top
		};
	}

	$effect(() => {
		void shown;
		void order;
		void touch.on;
		placeAnimals();
	});

	// The HUD leaves the screen (a battle, the doctor, the menu): an open card closes.
	$effect(() => () => {
		team.close();
		clearTimeout(hideTimer);
		clearTimeout(holdTimer);
		clearTimeout(dropTimer);
		stopScrolling();
	});

	// --- dragging a card --------------------------------------------------------

	interface Drag {
		speciesId: string;
		pointerId: number;
		pointer: Pointer;
		/** The card's place when it was picked up. */
		from: number;
		/** The cards' order then: a drag only draws over the column it was measured on. */
		order: string;
		/** When the pointer went down (`performance.now()`), and where, and where it is. */
		downAt: number;
		startY: number;
		y: number;
		/** Pressed, lifted (it still taps if let go), or carried (a drag, never a tap). */
		phase: DragPhase;
		/** Dropped at `to`, waiting for the party to come back in that order. */
		dropped: boolean;
		to: number;
		startScroll: number;
		scroll: number;
		/** The column when the card lifted: each card's top and height. */
		column: Column;
	}
	let drag = $state<Drag | null>(null);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	let dropTimer: ReturnType<typeof setTimeout> | undefined;

	function pickUp(e: PointerEvent, from: number, speciesId: string) {
		if (!choosing || e.button !== 0 || drag) return;
		drag = {
			speciesId,
			pointerId: e.pointerId,
			pointer: e.pointerType === 'mouse' ? 'mouse' : 'finger',
			from,
			order,
			downAt: performance.now(),
			startY: e.clientY,
			y: e.clientY,
			phase: 'pressed',
			dropped: false,
			to: from,
			startScroll: 0,
			scroll: 0,
			column: { tops: [], heights: [] }
		};
		if (drag.pointer === 'finger') holdTimer = setTimeout(() => advance(HOLD_MS), HOLD_MS);
	}

	/**
	 * The press moves on as the pointer moves or holds still (`dragPhase`):
	 * the card lifts, is carried, or a finger that moved first lets it go to
	 * scroll the column. `heldMs`: how long it has been down, if not now.
	 */
	function advance(heldMs?: number) {
		const d = drag;
		if (!d || d.dropped) return;
		const held = heldMs ?? performance.now() - d.downAt;
		const next = dragPhase(d.pointer, d.phase, Math.abs(d.y - d.startY), held);
		if (next === 'scroll') return letGo();
		if (d.phase === 'pressed' && next !== 'pressed') lift(d);
		d.phase = next;
		if (next === 'carried') keepScrolling();
	}

	/** The card lifts: measure the column it lifts from. */
	function lift(d: Drag) {
		if (!column) return;
		const cards = [...column.querySelectorAll<HTMLElement>('.bundle')];
		d.column = { tops: cards.map((c) => c.offsetTop), heights: cards.map((c) => c.offsetHeight) };
		d.startScroll = d.scroll = column.scrollTop;
		hovered = null;
	}

	function drift(e: PointerEvent) {
		if (!drag || e.pointerId !== drag.pointerId || drag.dropped) return;
		drag.y = e.clientY;
		advance();
	}

	function drop(e: PointerEvent) {
		const d = drag;
		if (!d || e.pointerId !== d.pointerId || d.dropped) return;
		clearTimeout(holdTimer);
		stopScrolling();
		// Never carried: a tap, which `input/taps.ts` has already pressed, as the card still named its key.
		const to = d.phase === 'carried' ? landing(d.column, d.from, offset(d)) : d.from;
		if (to === d.from || order !== d.order) {
			drag = null;
			return;
		}
		d.dropped = true;
		d.to = to;
		press(moveKey(d.speciesId, to));
		// The party comes back in its new order on the next frame; should nothing come, let go.
		dropTimer = setTimeout(() => (drag = null), 600);
	}

	function letGo() {
		clearTimeout(holdTimer);
		stopScrolling();
		drag = null;
	}

	/** How far the lifted card is drawn from its place: as far as the pointer and the column's scroll have carried it. */
	function offset(d: Drag): number {
		return carriedBy(d.column, d.from, d.y - d.startY + (d.scroll - d.startScroll));
	}

	/** How far card `k` is drawn from its place while a card is lifted or dropped. */
	function shift(k: number): number {
		const d = drag;
		if (!d || d.phase === 'pressed' || order !== d.order) return 0;
		const by = offset(d);
		const to = d.dropped ? d.to : landing(d.column, d.from, by);
		return shiftOf(d.column, d.from, to, k, by, d.dropped);
	}

	/** The column scrolled (the edge, a wheel): a lifted card stays under the pointer. */
	function scrolled() {
		placeAnimals();
		if (drag && drag.phase !== 'pressed' && !drag.dropped && column) drag.scroll = column.scrollTop;
	}

	// --- scrolling the column under a card held at its edge --------------------

	let edgeFrame = 0;
	/** The last frame's time, and the scroll owed below a whole pixel, carried to the next frame. */
	let edgeClock = 0;
	let edgeOwed = 0;

	/**
	 * While the carried card is at the column's top or bottom edge, the column
	 * scrolls under it frame by frame, whether the pointer moves or rests
	 * (`edgeSpeed`), until the column's end shows or the card leaves the edge;
	 * the next move starts it again.
	 */
	function keepScrolling() {
		if (edgeFrame) return;
		edgeClock = 0;
		edgeFrame = requestAnimationFrame(scrollStep);
	}

	function stopScrolling() {
		cancelAnimationFrame(edgeFrame);
		edgeFrame = 0;
		edgeOwed = 0;
	}

	function scrollStep(now: number) {
		edgeFrame = 0;
		const d = drag;
		if (!d || d.phase !== 'carried' || d.dropped || !column) return;
		const card = column.querySelector<HTMLElement>(`[data-species="${d.speciesId}"]`);
		const speed = card
			? edgeSpeed(card.getBoundingClientRect(), column.getBoundingClientRect(), d.y - d.startY)
			: 0;
		if (speed === 0) {
			edgeOwed = 0;
			return;
		}
		// A frame's time, never more than a tenth of a second: a page that was away doesn't jump.
		const dt = edgeClock ? Math.min(0.1, (now - edgeClock) / 1000) : 1 / 60;
		edgeClock = now;
		edgeOwed += speed * dt;
		const step = Math.trunc(edgeOwed);
		edgeOwed -= step;
		if (step !== 0) {
			const before = column.scrollTop;
			column.scrollTop = before + step;
			d.scroll = column.scrollTop;
			// The column's end: nothing more to show that way.
			if (column.scrollTop === before) return;
		}
		edgeFrame = requestAnimationFrame(scrollStep);
	}

	// The party came back in another order: the drop has landed, and the column is itself again.
	$effect(() => {
		void order;
		untrack(() => {
			if (drag?.dropped) {
				clearTimeout(dropTimer);
				drag = null;
			}
		});
	});

	/**
	 * While a card is lifted a finger moves it, not the column: the column
	 * would scroll otherwise (`touch-action: pan-y`), and the browser would
	 * take the finger away from the card.
	 */
	function holdStill(node: HTMLElement) {
		const still = (e: TouchEvent) => {
			if (drag && drag.phase !== 'pressed' && e.cancelable) e.preventDefault();
		};
		node.addEventListener('touchmove', still, { passive: false });
		return () => node.removeEventListener('touchmove', still);
	}
</script>

<div class="party" bind:this={root}>
	<div class="cards" bind:this={column} onscroll={scrolled} {@attach holdStill}>
		{#each list as bundle, i (bundle.speciesId)}
			{@const mine = drag?.speciesId === bundle.speciesId ? drag : null}
			{@const up = mine !== null && mine.phase !== 'pressed'}
			<BundleCard
				animals={bundle.animals}
				{leadId}
				showLead={choosing}
				keyCap={choosing && i < KEYS ? String(i + 1) : null}
				press={mine?.phase === 'carried' ? 'drag' : cardKey(bundle)}
				open={shown?.speciesId === bundle.speciesId}
				class={up ? (mine?.dropped ? 'carried dropped' : 'carried') : 'still'}
				style="transform: translateY({shift(i)}px)"
				data-species={bundle.speciesId}
				onpointerdown={(e: PointerEvent) => pickUp(e, i, bundle.speciesId)}
				onpointermove={drift}
				onpointerup={drop}
				onpointercancel={letGo}
				onpointerenter={(e: PointerEvent) => pointAt(e, bundle.speciesId)}
				onpointerleave={pointAway}
			/>
		{/each}
	</div>
	{#if touch.on}
		{#if stacks || choosing}
			<div class="keys">
				<span>{stacks ? t('hud.openTouch') : t('hud.pickLeadTouch')}</span>
				{#if choosing}<span class="quiet">{t('hud.dragTouch')}</span>{/if}
			</div>
		{/if}
	{:else}
		<div class="keys">
			{#if choosing}
				<span><kbd>1</kbd>–<kbd>{Math.min(list.length, KEYS)}</kbd> {t('hud.pickLead')}</span>
			{/if}
			<button type="button" class="esc" data-press="Escape" {@attach unfocusable}>
				<kbd>{t('keys.esc')}</kbd>
				{t('hud.menu')}
			</button>
			{#if choosing}<span class="quiet">{t('hud.dragMouse')}</span>{/if}
		</div>
	{/if}
	{#if shown && fanAt}
		<!-- The open card's animals, beside the column, outside its scroll. -->
		<div
			class="fan"
			role="group"
			class:still={motion.reduced}
			style="top: {fanAt.top}px; left: {fanAt.left}px; max-height: {fanAt.height}px"
			onpointerenter={pointAtAnimals}
			onpointerleave={pointAway}
			transition:fade={{ duration: motion.reduced ? 0 : 120 }}
		>
			<BundleAnimals
				animals={shown.animals}
				leadId={game.party.length > 1 ? leadId : null}
				press={(animal) => animalKey(animal.id)}
				class="fan-list"
			/>
		</div>
	{/if}
</div>

<!-- The puzzles the player has solved and their tokens, the tools they own, and the world they are in. -->
<!-- With `?debug` the position and the cues have the corner; these go under them. -->
<div class="belongings" class:below-debug={flags.debug}>
	<!-- The two numbers a kid collects, side by side; with no room beside the tokens, the count goes under them. -->
	<div class="counts">
		<div class="solved"><Tick />{t('hud.solved', { count: game.solved })}</div>
		<div class="purse"><Coin />{t('hud.tokens', { count: game.tokens })}</div>
	</div>
	{#each tools as id (id)}
		<div class="tool"><ItemIcon {id} size={24} />{itemName(id)}</div>
	{/each}
	<!-- The number a kid reads out to a friend, a glance away. -->
	<div class="world">{t('worlds.world', { world: game.world })}</div>
</div>

<!-- The message line: the latest message while it is fresh, then the doctor
     prompt or the controls hint (see `state/hud.svelte.ts`). -->
{#if hud.message || hud.hint}
	<div class="hint" transition:fade={{ duration: 400 }}>
		{#if hud.message}
			<div class="message" transition:fade={{ duration: 400 }}>{hud.message}</div>
		{/if}
		{#if hud.hint}
			<div class="prompt">{hud.hint}</div>
		{/if}
	</div>
{/if}

<svelte:window onresize={placeAnimals} />

<style>
	.party {
		position: absolute;
		top: calc(16px + var(--safe-top));
		left: calc(16px + var(--safe-left));
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		max-height: calc(100vh - 32px - var(--safe-top) - var(--safe-bottom));
	}
	/* With the touch controls on, the column stops above the D-pad in the bottom-left corner. */
	:global(.touch) .party {
		max-height: calc(
			100vh - 16px - 20px - var(--tap) * 4 - 16px - var(--safe-top) - var(--safe-bottom)
		);
	}
	/*
	 * The cards, as wide as the widest of them needs, all the same; the column
	 * scrolls when it is taller than the screen allows. Its padding keeps the
	 * cards' shadows, the lead's ring and a stack's cards behind it inside the
	 * scroll box, which would cut them off.
	 */
	.cards {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 8px;
		min-height: 0;
		flex: 0 1 auto;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* The one thing a finger may scroll in explore: the column, when it is long. */
		touch-action: pan-y;
		scrollbar-width: thin;
		padding: 4px 16px 14px 4px;
		margin: -4px -16px -14px -4px;
	}
	/* A card keeps its height: the column scrolls rather than squeeze them. */
	.cards :global(.bundle) {
		flex: none;
	}
	.cards :global(.bundle.still) {
		transition:
			transform 0.16s ease-out,
			scale 0.12s ease-out;
	}
	:global(.touch) .cards :global(.bundle) {
		min-height: var(--tap);
	}
	/*
	 * The card lifted or carried: above the others, a little bigger, with a
	 * deeper shadow, so a finger held still sees it can move the card now.
	 */
	.cards :global(.bundle.carried) {
		z-index: 2;
		cursor: grabbing;
		/* No more than the column's 4 px of padding to the left holds, at the widest card (320 px). */
		scale: 1.025;
		transition: scale 0.12s ease-out;
		box-shadow:
			0 10px 24px rgba(45, 42, 50, 0.28),
			var(--hud-shadow);
	}
	.cards :global(.bundle.dropped) {
		transition:
			transform 0.12s ease-out,
			scale 0.12s ease-out;
	}
	@media (hover: hover) and (pointer: fine) {
		.cards :global(button.bundle.still) {
			cursor: grab;
		}
		.esc:hover {
			text-decoration: underline;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cards :global(.bundle.still),
		.cards :global(.bundle.carried),
		.cards :global(.bundle.dropped) {
			transition: none;
		}
	}
	.esc {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: 800;
	}
	.keys {
		display: flex;
		flex: none;
		flex-direction: column;
		gap: 4px;
		max-width: 320px;
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px 12px 6px 8px;
		font-weight: 800;
		font-size: 16px;
	}
	.quiet {
		font-weight: 600;
		opacity: 0.75;
	}
	kbd {
		display: inline-block;
		min-width: 12px;
		font-family: inherit;
		font-size: 16px;
		line-height: 1.3;
		text-align: center;
		padding: 0 6px;
		border-radius: 7px;
		background: rgba(0, 0, 0, 0.1);
		box-shadow: inset 0 -2px 0 rgba(0, 0, 0, 0.12);
	}
	/* An open card's animals: a card of their own beside the column, scrolling when long. */
	.fan {
		position: absolute;
		display: flex;
		flex-direction: column;
		width: max-content;
		min-width: 300px;
		/* As wide as a name of twelve of the widest letters needs beside its bar and tag, when there is room. */
		max-width: calc(100vw - 340px - var(--safe-left) - var(--safe-right));
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px;
		z-index: 3;
	}
	.fan :global(.fan-list) {
		min-height: 0;
	}
	.hint {
		position: absolute;
		bottom: calc(16px + var(--safe-bottom));
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: calc(100vw - 32px - 2 * max(var(--safe-left), var(--safe-right)));
		box-sizing: border-box;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 600;
		text-align: center;
	}
	.prompt {
		font-weight: 800;
	}
	/* With the touch controls on, the line stays between the D-pad and the buttons. */
	:global(.touch) .hint {
		max-width: calc(
			100vw - 2 * (20px + var(--tap) * 4 + 20px + max(var(--safe-left), var(--safe-right)))
		);
	}
	.message + .prompt {
		margin-top: 2px;
	}
	/* The top right: the puzzles solved and the tokens, and the tools and the world under them. */
	.belongings {
		position: absolute;
		top: calc(16px + var(--safe-top));
		right: calc(16px + var(--safe-right));
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		pointer-events: none;
	}
	.belongings.below-debug {
		top: calc(100px + var(--safe-top));
	}
	/*
	 * The count and the tokens in one row, the tokens at the right edge. The
	 * row stays clear of the party column (at most 320 px wide, from 16 px
	 * in): on a screen too narrow for both, the count wraps under the tokens.
	 */
	.counts {
		display: flex;
		flex-wrap: wrap-reverse;
		justify-content: flex-end;
		gap: 6px;
		max-width: calc(100vw - 32px - 340px - var(--safe-left) - var(--safe-right));
	}
	.solved,
	.purse,
	.tool {
		display: flex;
		align-items: center;
		gap: 6px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		white-space: nowrap;
	}
	.solved,
	.purse {
		padding: 6px 14px 6px 8px;
		font-size: 18px;
	}
	.tool {
		padding: 3px 12px 3px 6px;
		font-size: 16px;
	}
	.world {
		padding: 3px 12px;
		border-radius: var(--radius);
		background: var(--panel-bg);
		box-shadow: var(--hud-shadow);
		font-weight: 800;
		font-size: 16px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
</style>
