'use strict';
// SQLite 스키마. 날짜는 'YYYY-MM-DD'(서울 기준 달력 날짜), 시각은 UTC ISO('...Z'), 시간 양은 모두 분(minutes).
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK (priority IN (1,2,3)),
  success_criteria TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  carried_from_plan_id INTEGER REFERENCES plans(id),
  carried_text TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS plan_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  rev_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  priority INTEGER NOT NULL,
  success_criteria TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (plan_id, rev_no)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  priority INTEGER NOT NULL CHECK (priority IN (1,2,3)),
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  completed_at TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (task_id, tag)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
  blocked_reason TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT UNIQUE,
  created_at TEXT NOT NULL,
  CHECK (ended_at >= started_at)
);
CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);

CREATE TABLE IF NOT EXISTS completions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  idempotency_key TEXT UNIQUE,
  completed_at TEXT NOT NULL,
  reverted_at TEXT
);
-- 되돌리지 않은 완료 기록은 할 일당 최대 한 건 (버튼 잠금이 아니라 DB 제약으로 중복을 막는다)
CREATE UNIQUE INDEX IF NOT EXISTS uq_completions_active ON completions(task_id) WHERE reverted_at IS NULL;

CREATE TABLE IF NOT EXISTS review_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER REFERENCES plans(id),
  from_date TEXT,
  to_date TEXT,
  today TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 로그인 세션. 토큰 원문은 저장하지 않고 SHA-256만 저장한다.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 5일 관찰: 계정마다 하나. 질문·계획 규칙은 만든 뒤 고치지 않는다(고치는 길이 없음).
CREATE TABLE IF NOT EXISTS experiments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  question TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  calc_rule TEXT NOT NULL,
  plan_rule TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS day_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  record_date TEXT NOT NULL,
  planned_minutes INTEGER NOT NULL CHECK (planned_minutes >= 0),
  actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (user_id, record_date)
);

CREATE TABLE IF NOT EXISTS rule_changes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  changed_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  old_rule TEXT NOT NULL,
  new_rule TEXT NOT NULL,
  after_record1_id INTEGER NOT NULL REFERENCES day_records(id),
  after_record2_id INTEGER NOT NULL REFERENCES day_records(id)
);

CREATE TABLE IF NOT EXISTS review_carryovers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_plan_id INTEGER NOT NULL UNIQUE REFERENCES plans(id),
  to_plan_id INTEGER NOT NULL REFERENCES plans(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// 6번 DB(주인 열이 없는 표)를 7번 모양으로 올린다. 새 DB와 옛 DB가 같은 열 순서가 되도록 여기서만 열을 더한다.
function migrate(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
  for (const t of ['plans', 'review_snapshots']) {
    if (!has(t, 'user_id')) db.exec(`ALTER TABLE ${t} ADD COLUMN user_id INTEGER REFERENCES users(id)`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_plans_user ON plans(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
}

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { open, SCHEMA };
