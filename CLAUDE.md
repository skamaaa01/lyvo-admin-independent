# Working rules (memory)

## Backups before every deploy
- Before pushing anything to `main` that will be deployed (Vercel builds `main`; the VPS pulls `main`), refresh a backup branch to the CURRENT `origin/main` (the state that is live before the change).
- Keep at most 3 backup branches: `backup/1`, `backup/2`, `backup/3`. Never create more names. Always overwrite the slot whose tip is OLDEST (rotate), so the three slots hold the three most recent pre-deploy states.
- Commands (clones here fetch only `main`, so read the slots from the remote, never from local refs):

```
git fetch origin main
SLOT=$(for b in 1 2 3; do sha=$(git ls-remote --heads origin backup/$b | cut -f1); if [ -z "$sha" ]; then echo "0 $b"; else git fetch -q origin refs/heads/backup/$b && echo "$(git log -1 --format=%ct FETCH_HEAD) $b"; fi; done | sort -n | head -1 | cut -d" " -f2)
git push -f origin origin/main:refs/heads/backup/$SLOT
```

- Branch deletion is blocked from the cloud session (403); if an extra backup name ever exists, the owner deletes it on GitHub.

- To restore: `git checkout -B main origin/backup/<slot> && git push -f origin main` (only on the owner's instruction).

## Other standing rules
- Only push work the owner asked for; explain first and wait for "go" before coding anything new.
- Never run tests against the production database `lyvo`; tests run on the VPS against `lyvo_test`.
- Never paste secrets (DB password, API keys) into chat.
