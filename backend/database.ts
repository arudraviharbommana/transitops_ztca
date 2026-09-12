import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const DATA_DIR = path.resolve(process.cwd(), 'backend', 'data');
const DATABASE_PATH = process.env.TRANSITOPS_DB_PATH || path.join(DATA_DIR, 'transitops.db');

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

export const database = new Database(DATABASE_PATH);
database.pragma('journal_mode = WAL');
database.exec(`
  CREATE TABLE IF NOT EXISTS records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection, id)
  );
  CREATE INDEX IF NOT EXISTS idx_records_collection_updated
    ON records (collection, updated_at DESC);
`);

type RecordWithId = { id: string };

function importJsonSeed<T extends RecordWithId>(collection: string, fileName: string): void {
  const count = database.prepare('SELECT COUNT(*) AS count FROM records WHERE collection = ?').get(collection) as { count: number };
  if (count.count > 0) return;

  const filePath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(filePath)) return;

  const records = JSON.parse(fs.readFileSync(filePath, 'utf8')) as T[];
  const insert = database.prepare(
    'INSERT OR IGNORE INTO records (collection, id, data) VALUES (?, ?, ?)'
  );
  const importRecords = database.transaction((items: T[]) => {
    for (const record of items) {
      insert.run(collection, record.id, JSON.stringify(record));
    }
  });
  importRecords(records);
}

export class DatabaseStore<T extends RecordWithId> {
  constructor(
    private readonly collection: string,
    private readonly seedFile: string
  ) {
    importJsonSeed<T>(collection, seedFile);
  }

  read(): T[] {
    const rows = database
      .prepare('SELECT data FROM records WHERE collection = ? ORDER BY updated_at DESC, rowid DESC')
      .all(this.collection) as Array<{ data: string }>;
    return rows.map(row => JSON.parse(row.data) as T);
  }

  write(records: T[]): void {
    const replace = database.transaction((items: T[]) => {
      database.prepare('DELETE FROM records WHERE collection = ?').run(this.collection);
      const insert = database.prepare(
        'INSERT INTO records (collection, id, data, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)'
      );
      for (const record of items) {
        insert.run(this.collection, record.id, JSON.stringify(record));
      }
    });
    replace(records);
  }
}
