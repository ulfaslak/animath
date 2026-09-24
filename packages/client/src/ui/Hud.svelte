<script lang="ts">
	import { getAnimal } from '@mathgame/engine';
	import { game } from '../state/game.svelte';
</script>

<div class="party">
	{#each game.party as animal (animal.id)}
		{@const spec = getAnimal(animal.speciesId)}
		<div class="member">
			<span class="name">{animal.nickname ?? spec.name}</span>
			<span class="hp">
				<span class="bar" style:width="{(100 * animal.hp) / spec.maxHp}%"></span>
			</span>
		</div>
	{/each}
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
		gap: 8px;
	}
	.member {
		background: var(--panel-bg);
		border-radius: var(--radius);
		box-shadow: var(--hud-shadow);
		padding: 8px 14px;
		min-width: 160px;
		font-weight: 800;
	}
	.hp {
		display: block;
		height: 10px;
		border-radius: 5px;
		background: rgba(0, 0, 0, 0.1);
		margin-top: 6px;
		overflow: hidden;
	}
	.bar {
		display: block;
		height: 100%;
		background: var(--good);
		border-radius: 5px;
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
