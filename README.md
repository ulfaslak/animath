# Screenshots

This branch holds the screenshots shown in pull request bodies. It has no code
and is never merged into `main`.

## Convention

Each pull request gets one folder named after its PR number:

```
<pr-number>/<image-name>.png
```

A PR body shows an image like this:

```
![<image name>](https://github.com/ulfaslak/animath/blob/screenshots/<pr-number>/<image-name>.png?raw=true)
```

Add files with `scripts/pr-screenshots.sh <pr-number> <file.png>...` from any
checkout of `main` or a branch: it never checks this branch out, and it prints
the markdown. `AGENTS/DNA/DEVELOPMENT.md` § Screenshots in PRs has the rest.

## Older folders

Before 2026-10-08 every PR pushed its own branch `screenshots/<name>`. Those
branches were folded into this one: the files of branch `screenshots/<name>`
now live in the folder `<name>/` (a name can contain a slash, such as
`feat/glider/`). The old image links in PR bodies keep working, because
`blob/screenshots/<name>/<file>` resolves to this branch and that folder. Do
not rename or move these folders.
