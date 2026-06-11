# Database backups & restore

A GitHub Action (`.github/workflows/nightly.yml`) runs every night at 02:17
Pacific. It checkpoints the SQLite WAL on the Fly machine, downloads
`/data/meeple-shelf.db`, **encrypts it** (the file contains password hashes and
this repo is public — artifacts on public repos are downloadable by any GitHub
account), and uploads it as a workflow artifact kept for **30 days**. The same
run refreshes `data/shelf-snapshot.json` and rebuilds the public page when the
library changed.

The encryption passphrase lives in:

- the repo secret `BACKUP_PASSPHRASE` (used by the Action),
- `.backup-passphrase` in the local checkout (gitignored),
- your password manager (put it there — if the laptop and the repo secret are
  both gone, the backups are unreadable without it).

## Restore

1. GitHub → Actions → "Nightly backup & page refresh" → pick a run → download
   the `db-backup-…` artifact and unzip it → `meeple-shelf-YYYY-MM-DD.db.enc`.

2. Decrypt:

   ```sh
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
     -pass file:.backup-passphrase \
     -in meeple-shelf-YYYY-MM-DD.db.enc -out restored.db
   ```

3. Sanity-check it (`sqlite3 restored.db 'SELECT COUNT(*) FROM games;'`), then
   put it on the volume and restart so the server reopens the new file:

   ```sh
   fly ssh sftp shell -a meeple-shelf
   » put restored.db /data/restore.db
   » exit
   fly ssh console -a meeple-shelf -C "sh -c 'rm -f /data/meeple-shelf.db /data/meeple-shelf.db-wal /data/meeple-shelf.db-shm && mv /data/restore.db /data/meeple-shelf.db'"
   fly apps restart meeple-shelf
   ```

## Manual backup (any time)

```sh
fly ssh console -a meeple-shelf -C "node /app/backup-prep.js"
fly ssh sftp get /data/meeple-shelf.db ./manual-backup-$(date +%F).db -a meeple-shelf
```

Keep manual copies out of the repo — `data/*.db` is gitignored for a reason.
