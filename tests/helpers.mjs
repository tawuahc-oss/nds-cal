import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export async function loadWorker(path = '../worker.js') {
  const source = (await readFile(new URL(path, import.meta.url), 'utf8'))
    .replace("from './public-backup.js'",'from '+JSON.stringify(new URL('../public-backup.js',import.meta.url).href));
  // Export pure helpers only inside the test process; production exports stay unchanged.
  return import('data:text/javascript;base64,' + Buffer.from(source +
    '\nexport { validateRecurrence, expandSeries, occurrenceOrdinal, validOriginalOccurrence, validateEvent, readRange };').toString('base64'));
}

export async function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(await readFile(new URL('../docs/schema.sql', import.meta.url), 'utf8'));
  sqlite.exec('PRAGMA foreign_keys=ON');
  const statement = (sql, values = []) => ({
    bind(...args) { return statement(sql, args); },
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { const results=sqlite.prepare(sql).all(...values); return { results,
      meta:{changes:/^\s*(SELECT|PRAGMA)/i.test(sql)?0:sqlite.prepare('SELECT changes() n').get().n} }; },
    async run() { const result = sqlite.prepare(sql).run(...values); return { success: true, meta: { changes: result.changes } }; }
  });
  const DB = {
    prepare: statement,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = [];
        for (const s of statements) result.push(await s.all());
        sqlite.exec('COMMIT');
        return result;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    }
  };
  // Test-only session; no production credentials or sessions are read.
  const token = 'a'.repeat(64);
  sqlite.prepare('INSERT INTO admin_sessions(id,token_hash,expires_at) VALUES(?,?,?)')
    .run(randomUUID(), createHash('sha256').update(token).digest('hex'), '2099-01-01T00:00:00.000Z');
  return { DB, sqlite, token, close: () => sqlite.close() };
}

export const baseEvent = {
  title: '測試聚會', start_at: '2026-11-02', end_at: null, all_day: 1,
  category_id: null, location: null, description: null, notes: null
};
export const rule = (patch = {}) => ({
  frequency: 'monthly', interval_value: 1, by_weekday: '1MO',
  day_of_month: null, until_date: null, occurrence_count: null, ...patch
});
export const series = (patch = {}) => ({
  ...baseEvent, ...rule(), id: '11111111-1111-4111-8111-111111111111',
  event_id: '22222222-2222-4222-8222-222222222222', ...patch
});
