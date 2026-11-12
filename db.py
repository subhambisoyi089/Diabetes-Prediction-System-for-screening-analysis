"""
db.py
-----
Tiny SQLite layer (standard library only). One connection per request,
foreign keys on, schema created automatically on first run.
"""

import sqlite3

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT    NOT NULL,
    email            TEXT    NOT NULL UNIQUE,
    password_hash    TEXT    NOT NULL,
    failed_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until     TEXT,
    created_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT    NOT NULL,
    risk_percent    REAL    NOT NULL,
    prediction      TEXT    NOT NULL,
    health_score    INTEGER NOT NULL,
    bmi             REAL,
    glucose         REAL,
    blood_pressure  REAL,
    age             INTEGER,
    model_used      TEXT,
    inputs          TEXT    NOT NULL,   -- JSON: everything the user submitted
    result          TEXT    NOT NULL    -- JSON: full prediction payload
);

CREATE INDEX IF NOT EXISTS idx_assessments_user
    ON assessments (user_id, created_at);
"""


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def close_db(_exc=None) -> None:
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db(app) -> None:
    with app.app_context():
        conn = sqlite3.connect(app.config["DATABASE"])
        conn.executescript(SCHEMA)
        conn.commit()
        conn.close()
    app.teardown_appcontext(close_db)
