# Human TODO

Tasks that genuinely require human action — accounts, consents, decisions that need human judgment. Running servers, migrations, and database operations are NOT human tasks; agents do those.

- **Decide what the leash hint should follow.** UI_SPEC § Battle mode colours the Leash row by the wild animal's HP in thirds, so a bear at a third of its HP shows green ("weak") while a throw catches it about 6 times in 100; a squirrel at the same HP is about 28. Keep HP thirds, or band on the real catch odds (the engine's `catchProbability`)? Either is a small change to `BattlePanel.svelte` and one UI_SPEC line. (PR #13)
