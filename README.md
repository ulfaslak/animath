# Animath

A cheerful low-poly adventure for kids where every attack is a math puzzle. Explore a procedurally generated world, catch animals, battle Game Boy Pokémon style — and hit harder by solving harder math.

Kids in the same world see each other, watch each other's battles and challenge each other to friendly matches. Play it at https://animath.xyz.

## Run it

```bash
pnpm install
pnpm db:up && pnpm db:migrate
pnpm dev            # client on http://localhost:5180, API on :3000
```

Controls, hidden behaviour and known exploits: [`AGENTS/DNA/CHEATSHEET.md`](AGENTS/DNA/CHEATSHEET.md).

## Layout

- `packages/engine` — pure game rules (puzzles, battle math, world generation). No dependencies.
- `packages/client` — Three.js rendering + Svelte HUD, built with Vite.
- `packages/server` — Hono API + Postgres (Drizzle).
- `AGENTS/` — persistent project context for agents and humans. Start with `CLAUDE.md`.

Everything about how the game works is in `AGENTS/DNA/PRODUCT.md`.
