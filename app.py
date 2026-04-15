import json
import random
import threading
from datetime import date, timedelta

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

import augment
import database as db
import srs

app = Flask(__name__, static_folder="static")
CORS(app)

db.init_db()


# ── Static files ─────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/static/<path:path>")
def static_files(path):
    return send_from_directory("static", path)


# ── Sessions ──────────────────────────────────────────────────────────────────

@app.route("/session/new", methods=["POST"])
def new_session():
    data = request.json or {}
    notes = data.get("notes", "")
    today = date.today().isoformat()

    with db.get_db() as conn:
        cur = conn.execute(
            "INSERT INTO sessions (date, notes) VALUES (?, ?)", (today, notes)
        )
        session_id = cur.lastrowid

    return jsonify({"session_id": session_id, "date": today, "notes": notes})


@app.route("/sessions", methods=["GET"])
def list_sessions():
    with db.get_db() as conn:
        rows = conn.execute(
            """SELECT s.id, s.date, s.notes,
                      COUNT(w.id) as word_count
               FROM sessions s
               LEFT JOIN words w ON w.session_id = s.id
               GROUP BY s.id
               ORDER BY s.id DESC
               LIMIT 20"""
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/session/<int:session_id>/words", methods=["GET"])
def session_words(session_id):
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, korean, english, example_sentence_user FROM words WHERE session_id = ? ORDER BY id DESC",
            (session_id,),
        ).fetchall()
    return jsonify([dict(r) for r in rows])


# ── Words ─────────────────────────────────────────────────────────────────────

@app.route("/word/validate", methods=["POST"])
def validate_word():
    data = request.json or {}
    korean = data.get("korean", "").strip()
    english = data.get("english", "").strip()
    sentence = data.get("sentence", "").strip()

    if not korean or not english:
        return jsonify({"error": "korean and english are required"}), 400

    try:
        result = augment.validate_word(korean, english, sentence)
        return jsonify(result)
    except Exception as e:
        # On validation error, let the user proceed rather than blocking them
        print(f"[validate] error: {e}")
        return jsonify({"ok": True})


@app.route("/word/add", methods=["POST"])
def add_word():
    data = request.json
    session_id = data.get("session_id")
    korean = data.get("korean", "").strip()
    english = data.get("english", "").strip()  # Traditional Chinese meaning
    sentence = data.get("example_sentence", "").strip()

    if not korean or not english:
        return jsonify({"error": "korean and english fields are required"}), 400

    today = date.today().isoformat()

    with db.get_db() as conn:
        cur = conn.execute(
            "INSERT INTO words (session_id, korean, english, example_sentence_user) VALUES (?, ?, ?, ?)",
            (session_id, korean, english, sentence),
        )
        word_id = cur.lastrowid

        conn.execute(
            "INSERT INTO review_cards (word_id, ease_factor, interval, due_date, review_count) VALUES (?, 2.5, 1, ?, 0)",
            (word_id, today),
        )

    # Trigger async Claude augmentation
    def do_augment():
        try:
            result = augment.augment_word(korean, english, sentence)
            with db.get_db() as conn:
                conn.execute(
                    """INSERT OR REPLACE INTO augmentations
                       (word_id, sentences, usage_notes, related_words, common_mistakes)
                       VALUES (?, ?, ?, ?, ?)""",
                    (
                        word_id,
                        json.dumps(result.get("sentences", []), ensure_ascii=False),
                        result.get("usage_notes", ""),
                        json.dumps(result.get("related_words", []), ensure_ascii=False),
                        result.get("common_mistakes", ""),
                    ),
                )
        except Exception as e:
            print(f"[augment] word {word_id} failed: {e}")

    threading.Thread(target=do_augment, daemon=True).start()

    return jsonify({"word_id": word_id, "status": "saved", "augmentation": "pending"})


@app.route("/word/<int:word_id>/augmentation", methods=["GET"])
def get_augmentation(word_id):
    with db.get_db() as conn:
        aug = conn.execute(
            "SELECT * FROM augmentations WHERE word_id = ?", (word_id,)
        ).fetchone()

    if not aug:
        return jsonify({"status": "pending"})

    result = dict(aug)
    result["sentences"] = json.loads(result["sentences"]) if result["sentences"] else []
    result["related_words"] = (
        json.loads(result["related_words"]) if result["related_words"] else []
    )
    result["status"] = "done"
    return jsonify(result)


# ── Word bank ─────────────────────────────────────────────────────────────────

@app.route("/words", methods=["GET"])
def list_words():
    page   = max(1, int(request.args.get("page", 1)))
    limit  = max(1, min(50, int(request.args.get("limit", 30))))
    search = request.args.get("search", "").strip()
    offset = (page - 1) * limit
    today  = date.today().isoformat()

    with db.get_db() as conn:
        if search:
            pattern = f"%{search}%"
            total = conn.execute(
                "SELECT COUNT(*) FROM words WHERE korean LIKE ? OR english LIKE ?",
                (pattern, pattern)
            ).fetchone()[0]
            rows = conn.execute(
                """SELECT w.id, w.korean, w.english, w.example_sentence_user,
                          s.date as session_date,
                          rc.due_date, rc.interval,
                          a.sentences, a.usage_notes, a.related_words, a.common_mistakes
                   FROM words w
                   LEFT JOIN sessions s ON s.id = w.session_id
                   LEFT JOIN review_cards rc ON rc.word_id = w.id
                   LEFT JOIN augmentations a ON a.word_id = w.id
                   WHERE w.korean LIKE ? OR w.english LIKE ?
                   ORDER BY w.id DESC
                   LIMIT ? OFFSET ?""",
                (pattern, pattern, limit, offset)
            ).fetchall()
        else:
            total = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]
            rows = conn.execute(
                """SELECT w.id, w.korean, w.english, w.example_sentence_user,
                          s.date as session_date,
                          rc.due_date, rc.interval,
                          a.sentences, a.usage_notes, a.related_words, a.common_mistakes
                   FROM words w
                   LEFT JOIN sessions s ON s.id = w.session_id
                   LEFT JOIN review_cards rc ON rc.word_id = w.id
                   LEFT JOIN augmentations a ON a.word_id = w.id
                   ORDER BY w.id DESC
                   LIMIT ? OFFSET ?""",
                (limit, offset)
            ).fetchall()

    words = []
    for r in rows:
        w = dict(r)
        w["sentences"]    = json.loads(w["sentences"])    if w["sentences"]    else []
        w["related_words"] = json.loads(w["related_words"]) if w["related_words"] else []
        # SRS status label
        if not w["due_date"]:
            w["srs_label"] = ""
        elif w["due_date"] < today:
            w["srs_label"] = "overdue"
        elif w["due_date"] == today:
            w["srs_label"] = "today"
        else:
            from datetime import date as _date
            days = (_date.fromisoformat(w["due_date"]) - _date.fromisoformat(today)).days
            w["srs_label"] = f"in_{days}"
        words.append(w)

    return jsonify({
        "words": words,
        "total": total,
        "page": page,
        "limit": limit,
        "has_more": offset + len(words) < total,
    })


# ── Review ────────────────────────────────────────────────────────────────────

@app.route("/review/queue", methods=["GET"])
def review_queue():
    today = date.today().isoformat()

    with db.get_db() as conn:
        rows = conn.execute(
            """SELECT w.id, w.korean, w.english, w.example_sentence_user,
                      rc.ease_factor, rc.interval, rc.due_date, rc.review_count,
                      a.sentences, a.usage_notes, a.related_words, a.common_mistakes
               FROM review_cards rc
               JOIN words w ON w.id = rc.word_id
               LEFT JOIN augmentations a ON a.word_id = w.id
               WHERE rc.due_date <= ?
               ORDER BY rc.due_date ASC""",
            (today,),
        ).fetchall()

        # All words for multiple-choice distractors
        all_words = conn.execute(
            "SELECT id, korean, english FROM words"
        ).fetchall()

    formats = ["flashcard", "fill_blank", "multiple_choice"]
    cards = []

    for row in rows:
        card = dict(row)
        if card["sentences"]:
            card["sentences"] = json.loads(card["sentences"])
        if card["related_words"]:
            card["related_words"] = json.loads(card["related_words"])

        fmt = formats[card["review_count"] % len(formats)]

        # Only use multiple_choice if we have enough other words for distractors
        others = [w for w in all_words if w["id"] != card["id"]]
        if fmt == "multiple_choice" and len(others) < 3:
            fmt = "flashcard"

        card["format"] = fmt

        if fmt == "multiple_choice":
            distractors = random.sample(others, 3)
            options = [{"korean": card["korean"], "english": card["english"]}] + [
                {"korean": w["korean"], "english": w["english"]} for w in distractors
            ]
            random.shuffle(options)
            card["options"] = options

        cards.append(card)

    return jsonify(cards)


@app.route("/review/result", methods=["POST"])
def review_result():
    data = request.json
    word_id = data["word_id"]
    result = data["result"]  # pass / hard / fail
    today = date.today().isoformat()

    with db.get_db() as conn:
        card = conn.execute(
            "SELECT ease_factor, interval, review_count FROM review_cards WHERE word_id = ?",
            (word_id,),
        ).fetchone()

        if not card:
            return jsonify({"error": "card not found"}), 404

        new_ef, new_interval, new_due = srs.sm2_update(
            card["ease_factor"], card["interval"], card["review_count"], result
        )

        conn.execute(
            """UPDATE review_cards
               SET ease_factor=?, interval=?, due_date=?, review_count=review_count+1
               WHERE word_id=?""",
            (new_ef, new_interval, new_due, word_id),
        )

        conn.execute(
            "INSERT INTO review_log (word_id, reviewed_at, result) VALUES (?, ?, ?)",
            (word_id, today, result),
        )

    return jsonify({"new_interval": new_interval, "next_due": new_due})


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.route("/dashboard", methods=["GET"])
def dashboard():
    today = date.today().isoformat()

    with db.get_db() as conn:
        total_words = conn.execute("SELECT COUNT(*) FROM words").fetchone()[0]

        due_count = conn.execute(
            "SELECT COUNT(*) FROM review_cards WHERE due_date <= ?", (today,)
        ).fetchone()[0]

        today_reviewed = conn.execute(
            "SELECT COUNT(*) FROM review_log WHERE reviewed_at = ?", (today,)
        ).fetchone()[0]

        # Streak: consecutive days with at least one review (counting backwards from today)
        streak = 0
        check = date.today()
        while True:
            count = conn.execute(
                "SELECT COUNT(*) FROM review_log WHERE reviewed_at = ?",
                (check.isoformat(),),
            ).fetchone()[0]
            if count > 0:
                streak += 1
                check -= timedelta(days=1)
            else:
                break

    return jsonify(
        {
            "total_words": total_words,
            "due_count": due_count,
            "today_reviewed": today_reviewed,
            "streak": streak,
        }
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=True)
