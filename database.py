import sqlite3
from contextlib import contextmanager

DB_PATH = "korean_app.db"


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date TEXT NOT NULL,
                notes TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS words (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                korean TEXT NOT NULL,
                english TEXT NOT NULL,
                example_sentence_user TEXT DEFAULT '',
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );

            CREATE TABLE IF NOT EXISTS augmentations (
                word_id INTEGER PRIMARY KEY,
                sentences TEXT,
                usage_notes TEXT DEFAULT '',
                related_words TEXT,
                common_mistakes TEXT DEFAULT '',
                FOREIGN KEY (word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS review_cards (
                word_id INTEGER PRIMARY KEY,
                ease_factor REAL DEFAULT 2.5,
                interval INTEGER DEFAULT 1,
                due_date TEXT NOT NULL,
                review_count INTEGER DEFAULT 0,
                FOREIGN KEY (word_id) REFERENCES words(id)
            );

            CREATE TABLE IF NOT EXISTS review_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                word_id INTEGER,
                reviewed_at TEXT NOT NULL,
                result TEXT NOT NULL,
                FOREIGN KEY (word_id) REFERENCES words(id)
            );
        """)


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
