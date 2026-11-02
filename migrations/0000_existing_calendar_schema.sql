-- Baseline: create missing schema only; never replace existing tables or data.
CREATE TABLE IF NOT EXISTS admin_sessions (     id TEXT PRIMARY KEY,     token_hash TEXT NOT NULL UNIQUE,     expires_at TEXT NOT NULL,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS audit_logs (     id TEXT PRIMARY KEY,     action TEXT NOT NULL,     entity_type TEXT NOT NULL,     entity_id TEXT,     details_json TEXT,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS categories (     id TEXT PRIMARY KEY,     name TEXT NOT NULL UNIQUE,     color TEXT NOT NULL DEFAULT '#808080',     sort_order INTEGER NOT NULL DEFAULT 0,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );

CREATE TABLE IF NOT EXISTS event_exceptions (     id TEXT PRIMARY KEY,     recurrence_rule_id TEXT NOT NULL,     original_start_at TEXT NOT NULL,     action TEXT NOT NULL         CHECK (action IN ('cancelled', 'modified')),     override_json TEXT,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     FOREIGN KEY (recurrence_rule_id)         REFERENCES recurrence_rules(id)         ON DELETE CASCADE,     UNIQUE (recurrence_rule_id, original_start_at) );

CREATE TABLE IF NOT EXISTS events (     id TEXT PRIMARY KEY,     title TEXT NOT NULL,     description TEXT,     location TEXT,     start_at TEXT NOT NULL,     end_at TEXT,     all_day INTEGER NOT NULL DEFAULT 0         CHECK (all_day IN (0, 1)),     category_id TEXT,     notes TEXT,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     FOREIGN KEY (category_id)         REFERENCES categories(id)         ON DELETE SET NULL );

CREATE TABLE IF NOT EXISTS login_attempts (     id TEXT PRIMARY KEY,     attempted_at INTEGER NOT NULL );

CREATE TABLE IF NOT EXISTS recurrence_rules (     id TEXT PRIMARY KEY,     event_id TEXT NOT NULL UNIQUE,     frequency TEXT NOT NULL         CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly', 'custom')),     interval_value INTEGER NOT NULL DEFAULT 1         CHECK (interval_value >= 1),     by_weekday TEXT,     day_of_month INTEGER,     until_date TEXT,     occurrence_count INTEGER,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     FOREIGN KEY (event_id)         REFERENCES events(id)         ON DELETE CASCADE );

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE INDEX IF NOT EXISTS idx_events_category ON events(category_id);

CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);

CREATE INDEX IF NOT EXISTS idx_exceptions_rule ON event_exceptions(recurrence_rule_id);

CREATE INDEX IF NOT EXISTS idx_login_attempted ON login_attempts(attempted_at);

CREATE INDEX IF NOT EXISTS idx_recurrence_event ON recurrence_rules(event_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON admin_sessions(expires_at);
