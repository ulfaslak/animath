<script lang="ts">
	import { getAnimal } from '@mathgame/engine';
	import { game } from '../state/game.svelte';
	import HpBar from './HpBar.svelte';
</script>

<div class="party">
	{#each game.party as animal (animal.id)}
		{@const spec = getAnimal(animal.speciesId)}
		<div class="member" class:tired={animal.hp === 0}>
			<span class="name">
				{animal.nickname ?? spec.name}
				{#if animal.hp === 0}<span class="tag">tired</span>{/if}
			</span>
			<HpBar hp={animal.hp} max={spec.maxHp} />
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
		width: 200px;
		font-weight: 800;
	}
	.member.tired {
		opacity: 0.7;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.tag {
		font-size: 13px;
		font-weight: 800;
		padding: 1px 8px;
		border-radius: 8px;
		background: rgba(0, 0, 0, 0.1);
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
