# 韓語學習 — Korean Vocabulary Tutor

A mobile-first web app for logging Korean vocabulary from class and reviewing it
with spaced repetition. Built for learners who use Traditional Chinese as their
study language.

---

## Architecture

```
korean-tutor/
├── app.py          # Flask REST API (routes & request handling)
├── augment.py      # Claude AI integration (augmentation + validation)
├── database.py     # SQLite helpers (init, context-managed connections)
├── srs.py          # SM-2 spaced repetition algorithm
├── static/
│   ├── index.html  # Single-page app shell (all views in one file)
│   ├── app.js      # Vanilla JS frontend (state, API calls, UI logic)
│   └── style.css   # Mobile-first CSS with CSS variables
└── korean_app.db   # SQLite database (gitignored)
```

### Backend — Flask + SQLite

The backend is a thin Flask REST API with no ORM. Five tables handle the full
data model:

| Table | Purpose |
|---|---|
| `sessions` | One row per class session (date + optional notes) |
| `words` | Korean words with their Traditional Chinese meanings |
| `augmentations` | AI-generated study materials per word (1-to-1 with words) |
| `review_cards` | SRS state per word (ease factor, interval, due date) |
| `review_log` | Immutable history of every review result |

All database access goes through a `@contextmanager` that handles
commit/rollback automatically.

### Frontend — Vanilla JS SPA

A single HTML file with three views (Dashboard, Log Session, Review) toggled by
CSS classes — no framework, no build step. State is kept in module-level JS
variables; the active session survives page refresh via `localStorage` (cleared
at end of day).

### AI Layer — Claude API

Two separate Claude calls with different latency/cost tradeoffs:

| Call | Model | When | Purpose |
|---|---|---|---|
| `validate_word` | Haiku (fast) | On every word add | Check Korean spelling and meaning match; suggest corrections |
| `augment_word` | Sonnet | Async after save | Generate 3 example sentences, usage notes, related words, common mistakes |

Augmentation runs in a background thread so it never blocks the UI. The
frontend polls `/word/<id>/augmentation` every 3 seconds until the result
arrives.

### Spaced Repetition — SM-2

The classic SuperMemo 2 algorithm (`srs.py`). Each review result maps to a
quality score:

- **Pass** (q=5) → interval grows by ease factor
- **Hard** (q=2) → interval grows slowly, ease factor decreases
- **Fail** (q=0) → interval resets to 1 day, ease factor decreases

The review queue cycles through three formats based on review count:
flashcard → fill-in-blank → multiple choice → repeat.

---

## Current Features

### Session Logging
- Start a class session with optional notes (teacher name, lesson number, etc.)
- Add Korean words with Traditional Chinese meaning and an optional example sentence
- End session and start a new one at any time
- Word list shown immediately after adding, with AI analysis status

### AI Input Validation
- Before saving, Claude (Haiku) checks if the Korean spelling is correct and
  whether the meaning matches
- If an issue is found, a diff modal shows the original vs. suggested correction
- User can accept the suggestion or keep their original input
- Validation failures never block saving — the word always goes through

### AI Augmentation
- After a word is saved, Claude (Sonnet) asynchronously generates:
  - 3 example sentences (beginner / intermediate / advanced) with translations
  - Usage notes (grammar, register, context)
  - Related words
  - Common learner mistakes
- All output is in Traditional Chinese

### Spaced Repetition Review
- Daily review queue based on SM-2 due dates
- Three rotating question formats: flashcard, fill-in-blank, multiple choice
- Pass / Hard / Fail grading updates the next review interval
- Multiple choice distractors drawn from the full word bank

### Dashboard
- Total word count, today's review count, due cards count
- Daily streak counter (consecutive days with at least one review)

---

## Upcoming & Potential Features

### Near-term
- **Edit / delete words** — fix mistakes after a word has been saved
- **Session browser** — view past sessions and their word lists
- **Audio pronunciation** — text-to-speech for Korean words during review
- **Export** — download vocabulary as CSV or Anki deck

### AI Enhancements
- **Conversation-based lookup** — ask Claude questions about a word mid-review
- **Difficulty auto-detection** — use Claude to estimate word difficulty and
  seed the initial SM-2 ease factor accordingly
- **Personalized mistake analysis** — track patterns in wrong answers and have
  Claude generate targeted practice

### Review Improvements
- **Listening mode** — play audio, type what you hear (dictation)
- **Reverse mode** — show Chinese meaning, type the Korean
- **Session replay** — re-review only the words from a specific class

### Infrastructure
- **User accounts** — multi-user support with login
- **Cloud sync** — back up the SQLite database to cloud storage
- **PWA / offline mode** — install to home screen, review without internet
