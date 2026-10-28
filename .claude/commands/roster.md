# Roster

Who plays Animath on production, and how they are doing. Read-only: no worktree, nothing changed on the server.

1. Run `pnpm roster` from the primary clone (`~/git/mathgame`), as it is. Do not run anything else first: the script makes the one trip to the server and does the counting ([[DEVELOPMENT]] § Prod access). It prints the whole report, about 40 lines; it is the only thing to read.
2. Answer the human in a few short lines, plain words, no table copied out:
   - **Who plays.** How many played today and this week, who is new, who has gone quiet (no save for a week or more).
   - **How they are doing.** Who is moving fast (puzzles solved, animal book, a land unlocked), and who is struggling: a topic marked `!`, a low `lately`. Name the kid and the topic. A topic weak for many kids is a sign about the game's puzzle ladder, not about the kids: say so.
   - **Since last time.** The `since` column's movement, when there is a snapshot to compare with.
   - Anything odd: `no password yet`, games set aside (a kid started over), an old save version, error reports.
3. Stop there. Do not open saves, query the database, or read logs to dig further unless the human asks.

The script's header says what each number means and where it comes from. Accounts only: a guest's game lives in their browser and reaches the report only as the whole site's screen time and pages opened. Names are the kids' own: keep them out of PRs, issues and commits.
