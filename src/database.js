import Database from 'better-sqlite3';
import fs from 'fs';

fs.mkdirSync('data', { recursive: true });

const db = new Database('data/neonlotus.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS employees (
  discord_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  joined_at TEXT,
  left_at TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employee_ranks (
  discord_id TEXT NOT NULL,
  area TEXT NOT NULL,
  rank_name TEXT,
  joined_at TEXT,
  left_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (discord_id, area)
);

CREATE TABLE IF NOT EXISTS sanctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  paid_by TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  date_from TEXT NOT NULL,
  date_to TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS personnel_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  action TEXT NOT NULL,
  area TEXT,
  old_rank TEXT,
  new_rank TEXT,
  performed_by TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_invitations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  invited_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message_id TEXT,
  thread_id TEXT
);

CREATE TABLE IF NOT EXISTS cash_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  performed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  item TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  reason TEXT,
  performed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  amount INTEGER NOT NULL,
  performed_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  revoked_by TEXT,
  revoked_at TEXT
);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

ensureColumn('personnel_actions', 'area', 'TEXT');
ensureColumn('absences', 'created_by', "TEXT NOT NULL DEFAULT 'SYSTEM'");
ensureColumn('meeting_invitations', 'status', "TEXT NOT NULL DEFAULT 'OPEN'");
ensureColumn('meeting_invitations', 'completed_by', 'TEXT');
ensureColumn('meeting_invitations', 'completed_at', 'TEXT');
ensureColumn('sanctions', 'revoked_by', 'TEXT');
ensureColumn('sanctions', 'revoked_at', 'TEXT');
ensureColumn('sanctions', 'original_amount', 'INTEGER');
ensureColumn('sanctions', 'escalation_level', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sanctions', 'last_escalated_at', 'TEXT');
ensureColumn('sanctions', 'termination_pending', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sanctions', 'deadline_extension_days', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('sales', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
ensureColumn('sales', 'revoked_by', 'TEXT');
ensureColumn('sales', 'revoked_at', 'TEXT');
ensureColumn('cash_transactions', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
ensureColumn('cash_transactions', 'revoked_by', 'TEXT');
ensureColumn('cash_transactions', 'revoked_at', 'TEXT');
ensureColumn('inventory_transactions', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
ensureColumn('inventory_transactions', 'revoked_by', 'TEXT');
ensureColumn('inventory_transactions', 'revoked_at', 'TEXT');
ensureColumn('absences', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
ensureColumn('absences', 'revoked_by', 'TEXT');
ensureColumn('absences', 'revoked_at', 'TEXT');
ensureColumn('cash_updates', 'status', "TEXT NOT NULL DEFAULT 'ACTIVE'");
ensureColumn('cash_updates', 'revoked_by', 'TEXT');
ensureColumn('cash_updates', 'revoked_at', 'TEXT');

/*
 * Einmalige Übernahme des bisherigen Kassenstands:
 * Falls noch kein neuer Gesamtstand existiert, wird der bisherige Saldo aus den
 * alten Ein-/Auszahlungen als Startwert übernommen. Die alten Buchungen bleiben
 * ausschließlich als Legacy-Daten in der Datenbank bestehen.
 */
const cashUpdateCount = db.prepare(`
  SELECT COUNT(*) AS count
  FROM cash_updates
`).get().count;

if (cashUpdateCount === 0) {
  const legacyRows = db.prepare(`
    SELECT type, amount
    FROM cash_transactions
    WHERE COALESCE(status, 'ACTIVE') != 'REVOKED'
  `).all();

  if (legacyRows.length > 0) {
    const legacyBalance = legacyRows.reduce(
      (sum, row) =>
        sum + (row.type === 'IN' ? Number(row.amount || 0) : -Number(row.amount || 0)),
      0
    );

    db.prepare(`
      INSERT INTO cash_updates
      (amount, performed_by, created_at, status)
      VALUES (?, 'SYSTEM-MIGRATION', ?, 'ACTIVE')
    `).run(legacyBalance, new Date().toISOString());
  }
}


db.exec(`
  CREATE TABLE IF NOT EXISTS funk_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT,
    updated_at TEXT
  )
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS weekly_dues (
    discord_id TEXT PRIMARY KEY,
    base_amount INTEGER NOT NULL DEFAULT 0,
    amount_due INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    cycle_start TEXT,
    cycle_end TEXT,
    rank_name TEXT,
    paid_by TEXT,
    paid_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS weekly_dues_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    rank_name TEXT,
    base_amount INTEGER NOT NULL DEFAULT 0,
    amount_before INTEGER NOT NULL DEFAULT 0,
    amount_after INTEGER NOT NULL DEFAULT 0,
    previous_status TEXT,
    action TEXT NOT NULL,
    performed_by TEXT,
    created_at TEXT NOT NULL
  );
`);
ensureColumn('weekly_dues', 'prepaid_weeks', 'INTEGER NOT NULL DEFAULT 0');


db.exec(`
  CREATE TABLE IF NOT EXISTS employee_labels (
    discord_id TEXT NOT NULL,
    label TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (discord_id, label)
  );
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS hiring_blocks (
    discord_id TEXT PRIMARY KEY,
    reason TEXT NOT NULL,
    duration_value INTEGER,
    duration_unit TEXT,
    blocked_until TEXT,
    indefinite INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked_by TEXT,
    revoked_at TEXT
  );
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS employee_notifications (
    discord_id TEXT NOT NULL,
    notification_key TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (discord_id, notification_key)
  );
`);


db.exec(`
  CREATE TABLE IF NOT EXISTS termination_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT NOT NULL,
    termination_type TEXT NOT NULL DEFAULT 'NORMAL',
    last_rank TEXT,
    note TEXT,
    debt_amount INTEGER NOT NULL DEFAULT 0,
    terminated_by TEXT NOT NULL,
    terminated_at TEXT NOT NULL,
    bench_active INTEGER NOT NULL DEFAULT 0,
    bench_left_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_termination_records_discord
  ON termination_records(discord_id);

  CREATE INDEX IF NOT EXISTS idx_termination_records_bench
  ON termination_records(bench_active);
`);

export default db;
