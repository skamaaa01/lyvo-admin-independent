# Working rules (memory)

## Backups before every deploy
- Before pushing anything to `main` that will be deployed (Vercel builds `main`; the VPS pulls `main`), refresh a backup branch to the CURRENT `origin/main` (the state that is live before the change).
- Keep at most 3 backup branches: `backup/1`, `backup/2`, `backup/3`. Never create more names. Always overwrite the slot whose tip is OLDEST (rotate), so the three slots hold the three most recent pre-deploy states.
- Commands (run from the repo, after `git fetch origin`):

```
git fetch origin
SLOT=$(for b in 1 2 3; do d=$(git log -1 --format=%ct origin/backup/$b 2>/dev/null || echo 0); echo "$d $b"; done | sort -n | head -1 | cut -d" " -f2)
git push -f origin origin/main:refs/heads/backup/$SLOT
```

- To restore: `git checkout -B main origin/backup/<slot> && git push -f origin main` (only on the owner's instruction).

## Other standing rules
- Only push work the owner asked for; explain first and wait for "go" before coding anything new.
- Never run tests against the production database `lyvo`; tests run on the VPS against `lyvo_test`.
- Never paste secrets (DB password, API keys) into chat.
