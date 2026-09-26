<script lang="ts">
	import { getAnimal, type AnimalInstance } from '@mathgame/engine';
	import { t } from '../copy';
	import { unfocusable } from '../input/press';
	import { nameOf } from '../names';
	import HpBar from './HpBar.svelte';

	/**
	 * The animals of an open card (`BundleCard`): one row each, in party
	 * order — its name (the nickname, or the species' name), its HP bar with
	 * numbers, and a tag: "goes first" on the lead, "tired" at 0 HP. The rows
	 * line up in columns sized by the longest name, which shows whole. The
	 * list grows as long as its animals and its box scrolls: give it a
	 * `max-height` (a class, or a style) where it must stop.
	 *
	 * A reader: a click or a tap on a row is the key `press` names for its
	 * animal (`data-press`); without `press`, or where it names none, the row
	 * is not a button. `lit` lights one animal's row (a cursor) and
	 * `outlined` rings one (the one picked). `stacked` puts each row on two
	 * lines, the HP bar under the name and its tag, for a narrow box: a name
	 * of twelve of the widest letters still shows whole there.
	 */
	interface Props {
		animals: readonly AnimalInstance[];
		/** The lead's id: its row is tagged "goes first". */
		leadId?: string | null;
		/** The key a click or a tap on an animal's row presses. */
		press?: (animal: AnimalInstance, index: number) => string | undefined;
		/** The id of the animal whose row is lit. */
		lit?: string | null;
		/** The id of the animal whose row is outlined. */
		outlined?: string | null;
		/** Each row on two lines, the HP bar under the name, for a narrow box. */
		stacked?: boolean;
		class?: string;
		/** Called with the lit row's element whenever the lit row changes, to scroll it into view. */
		onlit?: (row: HTMLElement) => void;
	}
	let {
		animals,
		leadId = null,
		press,
		lit = null,
		outlined = null,
		stacked = false,
		class: className = '',
		onlit
	}: Props = $props();

	/** Tells the caller where the lit row is, each time it is (re)drawn lit. */
	function litRow(row: HTMLElement) {
		onlit?.(row);
	}
</script>

<div class="animals {className}" class:stacked>
	{#each animals as animal, i (animal.id)}
		{@const key = press?.(animal, i)}
		{@const isLit = lit === animal.id}
		<svelte:element
			this={key ? 'button' : 'div'}
			type={key ? 'button' : undefined}
			class="animal"
			class:tired={animal.hp === 0}
			class:lead={animal.id === leadId}
			class:lit={isLit}
			class:outlined={outlined === animal.id}
			data-press={key}
			{@attach key ? unfocusable : undefined}
			{@attach isLit ? litRow : undefined}
		>
			<span class="name">{nameOf(animal)}</span>
			<span class="bar"><HpBar hp={animal.hp} max={getAnimal(animal.speciesId).maxHp} /></span>
			<span class="how">
				{#if animal.hp === 0}
					<span class="tag">{t('party.tired')}</span>
				{:else if animal.id === leadId}
					<span class="tag lead">{t('hud.goesFirst')}</span>
				{/if}
			</span>
		</svelte:element>
	{/each}
</div>

<style>
	/*
	 * Rows lined up in shared columns — name, HP bar, tag — sized by the
	 * longest name there. A row is a subgrid of the list; its edge columns are
	 * `auto`, since a subgrid's padding is a margin on the items at its edges
	 * (UI_SPEC § Component reuse).
	 */
	.animals {
		display: grid;
		grid-template-columns: minmax(0, max-content) minmax(160px, 1fr) auto;
		grid-auto-rows: minmax(40px, auto);
		gap: 2px 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		/* The one thing a finger may scroll here: a long list of one kind. */
		touch-action: pan-y;
		scrollbar-width: thin;
	}
	:global(.touch) .animals {
		grid-auto-rows: var(--tap);
	}
	.animal {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(0, max-content) minmax(160px, 1fr) auto;
		grid-template-columns: subgrid;
		column-gap: 10px;
		align-items: center;
		padding: 0 10px;
		border-radius: 12px;
		font-weight: 800;
		font-size: 18px;
		text-align: left;
	}
	/* A mouse over a row it can press. Never on touch, where hover sticks after a tap. */
	@media (hover: hover) and (pointer: fine) {
		button.animal:not(.lit):hover {
			background: rgba(255, 159, 67, 0.12);
		}
	}
	.animal.lit {
		background: rgba(255, 159, 67, 0.22);
	}
	.animal.outlined {
		box-shadow: inset 0 0 0 3px var(--accent);
	}
	.animal.tired .name,
	.animal.tired .bar {
		opacity: 0.55;
		filter: grayscale(1);
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.how {
		display: flex;
		justify-content: flex-end;
		min-width: 0;
	}
	.tag {
		font-size: 16px;
		font-weight: 800;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
		white-space: nowrap;
	}
	.tag.lead {
		background: color-mix(in srgb, var(--accent) 40%, white);
	}
	/* Two lines a row: the name and its tag, then the HP bar the row's full width. */
	.stacked {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.stacked .animal {
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-areas:
			'name how'
			'bar bar';
		gap: 2px 10px;
		padding: 5px 10px 6px;
		flex: none;
	}
	.stacked .name {
		grid-area: name;
	}
	.stacked .bar {
		grid-area: bar;
	}
	.stacked .how {
		grid-area: how;
	}
</style>
