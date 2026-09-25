<script lang="ts">
	import { getAnimal, leadIndex } from '@mathgame/engine';
	import { nameOf } from '../names';
	import { game } from '../state/game.svelte';
	import HpBar from './HpBar.svelte';

	/**
	 * The explore HUD. One card per animal in battle order: the number key that
	 * makes it go first, its name, an HP bar with numbers, and "tired" when it
	 * is knocked out. The lead — the engine's `leadIndex`, the first animal
	 * standing, the one a battle sends out — is outlined and tagged "goes
	 * first". Under the cards, the keys for choosing and for the menu; at the
	 * bottom, the message line.
	 */

	/** Every word the cards and keys show, in one place for translation. */
	const COPY = {
		tired: 'tired',
		lead: 'goes first',
		choose: 'Pick who goes first',
		menu: 'Menu'
	};

	const lead = $derived(leadIndex(game.party));
	/** With one animal there is nobody to choose between: no numbers, no tag. */
	const choosing = $derived(game.party.length > 1);
</script>

<div class="party">
	{#each game.party as animal, i (animal.id)}
		{@const spec = getAnimal(animal.speciesId)}
		<div class="member" class:tired={animal.hp === 0} class:lead={choosing && i === lead}>
			<div class="top">
				{#if choosing}<kbd class="slot">{i + 1}</kbd>{/if}
				<span class="name">{nameOf(animal)}</span>
				{#if animal.hp === 0}
					<span class="tag">{COPY.tired}</span>
				{:else if choosing && i === lead}
					<span class="tag lead">{COPY.lead}</span>
				{/if}
			</div>
			<div class="hp"><HpBar hp={animal.hp} max={spec.maxHp} /></div>
		</div>
	{/each}
	<div class="keys">
		{#if choosing}
			<span><kbd>1</kbd>–<kbd>{game.party.length}</kbd> {COPY.choose}</span>
		{/if}
		<span><kbd>Esc</kbd> {COPY.menu}</span>
	</div>
</div>

<div class="hint">
	Arrows / WASD to walk · {game.pos.x}, {game.pos.y}
	{#if game.message}
		· {game.message}
	{/if}
</div>

<style>
	.party {
		position: absolute;
		top: 16px;
		left: 16px;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	.member {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 7px 14px 8px 10px;
		width: 260px;
		box-sizing: border-box;
		font-weight: 800;
	}
	.member.lead {
		box-shadow:
			0 0 0 3px var(--accent),
			var(--hud-shadow);
	}
	.member.tired .name,
	.member.tired .hp {
		opacity: 0.55;
		filter: grayscale(1);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
		font-size: 18px;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		flex: none;
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
	.keys {
		display: flex;
		flex-direction: column;
		gap: 4px;
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 6px 12px 6px 8px;
		font-weight: 800;
		font-size: 16px;
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
	.slot {
		flex: none;
	}
	.member.lead .slot {
		background: var(--accent);
	}
	.hint {
		position: absolute;
		bottom: 16px;
		left: 50%;
		transform: translateX(-50%);
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 16px;
		font-weight: 600;
		white-space: nowrap;
	}
</style>
