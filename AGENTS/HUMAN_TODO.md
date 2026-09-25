# Human TODO

Tasks that genuinely require human action — accounts, consents, decisions that need human judgment. Running servers, migrations, and database operations are NOT human tasks; agents do those.

- **Decide what the leash hint should follow.** UI_SPEC § Battle mode colours the Leash row by the wild animal's HP in thirds, so a bear at a third of its HP shows green ("weak") while a throw catches it about 6 times in 100; a squirrel at the same HP is about 28. Keep HP thirds, or band on the real catch odds (the engine's `catchProbability`)? Either is a small change to `BattlePanel.svelte` and one UI_SPEC line. (PR #13)
- **Decide whether a strong lead should find some tall grass quiet.** With encounters indexed on the lead, nothing two or more tiers below it comes out, so a bear in front meets nothing in the meadow or at the river (59% of the tall grass near spawn) and a wolf nothing at the river. Keep it (the kid puts a smaller animal in front to meet smaller ones, and a bear is a repel there), or let those biomes get visitors of the lead's tier too? Also worth a look after play: one tier below weighs 1/10 of the lead's own tier (PRODUCT §4). (PR #17)
