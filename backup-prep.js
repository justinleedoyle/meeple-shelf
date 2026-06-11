// Flushes the WAL into the main database file so a plain file copy of
// /data/meeple-shelf.db is a complete, consistent backup. Run on the Fly
// machine right before downloading the file (see .github/workflows/nightly.yml).

import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || '/data/meeple-shelf.db');
db.pragma('wal_checkpoint(TRUNCATE)');
db.close();
console.log('WAL checkpointed — the .db file is safe to copy');
