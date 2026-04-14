// ── State ────────────────────────────────────────────────────────────────────
let currentSession = null;   // { id, date, notes }
let sessionWordCount = 0;

let reviewQueue = [];
let reviewIndex = 0;
let currentCard = null;
let cardFlipped = false;
let mcAnswered = false;
let fbChecked = false;

// ── Startup ───────────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  loadDashboard();

  // Restore session from localStorage if today's
  const saved = localStorage.getItem('session');
  if (saved) {
    const s = JSON.parse(saved);
    const today = new Date().toISOString().split('T')[0];
    if (s.date === today) {
      currentSession = s;
      showActiveSession();
      loadSessionWords();
    } else {
      localStorage.removeItem('session');
    }
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────
function switchView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById(`view-${view}`).classList.add('active');
  document.getElementById(`nav-${view}`).classList.add('active');

  if (view === 'dashboard') loadDashboard();
  if (view === 'review')    loadReviewQueue();
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const data = await api('/dashboard');
    document.getElementById('stat-streak').textContent = data.streak;
    document.getElementById('stat-total').textContent = data.total_words;
    document.getElementById('stat-due').textContent = data.due_count;
    document.getElementById('stat-reviewed').textContent = data.today_reviewed;

    const btn = document.getElementById('btn-start-review');
    btn.textContent = data.due_count > 0
      ? `開始複習（${data.due_count} 張）`
      : '今日已完成 🎉';
  } catch (e) { console.error('dashboard error', e); }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function startNewSession() {
  const notes = document.getElementById('session-notes').value.trim();
  try {
    const data = await api('/session/new', { method: 'POST', body: { notes } });
    currentSession = { id: data.session_id, date: data.date, notes };
    localStorage.setItem('session', JSON.stringify(currentSession));
    sessionWordCount = 0;
    showActiveSession();
  } catch (e) { showToast('無法建立課堂，請重試'); }
}

function showActiveSession() {
  document.getElementById('log-no-session').classList.add('hidden');
  document.getElementById('log-active-session').classList.remove('hidden');
  document.getElementById('session-date-display').textContent =
    `📅 ${currentSession.date}${currentSession.notes ? '・' + currentSession.notes : ''}`;
  updateWordCount();
}

function updateWordCount() {
  document.getElementById('session-word-count').textContent = `${sessionWordCount} 個單字`;
}

function endSession() {
  currentSession = null;
  sessionWordCount = 0;
  localStorage.removeItem('session');
  document.getElementById('log-active-session').classList.add('hidden');
  document.getElementById('log-no-session').classList.remove('hidden');
  document.getElementById('session-notes').value = '';
  document.getElementById('session-words').innerHTML = '';
}

async function loadSessionWords() {
  if (!currentSession) return;
  try {
    const words = await api(`/session/${currentSession.id}/words`);
    sessionWordCount = words.length;
    updateWordCount();
    const list = document.getElementById('session-words');
    list.innerHTML = words.map(w => wordItem(w, false)).join('');
  } catch (e) { console.error('loadSessionWords', e); }
}

function wordItem(w, augPending = true) {
  return `<div class="word-item" id="word-${w.id}">
    <div class="word-korean">${esc(w.korean)}</div>
    <div class="word-meaning">${esc(w.english)}</div>
    ${w.example_sentence_user ? `<div class="word-aug-status">${esc(w.example_sentence_user)}</div>` : ''}
    <div class="word-aug-status ${augPending ? '' : 'done'}" id="aug-status-${w.id}">
      ${augPending ? '⏳ AI 分析中…' : '✓ AI 分析完成'}
    </div>
  </div>`;
}

// ── Add word ──────────────────────────────────────────────────────────────────

// Pending word state while validation modal is open
let _pendingWord = null;

async function addWord() {
  if (!currentSession) { showToast('請先開始新課堂'); return; }

  const korean = document.getElementById('word-korean').value.trim();
  const english = document.getElementById('word-meaning').value.trim();
  const sentence = document.getElementById('word-sentence').value.trim();

  if (!korean || !english) { showToast('請填寫韓語單字和中文意思'); return; }

  // Disable button and show validating state
  const btn = document.querySelector('.add-word-form .btn-primary');
  btn.textContent = 'AI 驗證中…';
  btn.disabled = true;

  try {
    const validation = await api('/word/validate', {
      method: 'POST',
      body: { korean, english, sentence }
    });

    if (validation.ok) {
      // All good — save directly
      await saveWord(korean, english, sentence);
    } else {
      // Show correction modal
      _pendingWord = {
        original: { korean, english, sentence },
        suggested: {
          korean: validation.suggested_korean,
          english: validation.suggested_meaning,
          sentence: validation.suggested_sentence || '',
        }
      };
      showValidationModal(validation);
    }
  } catch (e) {
    // Validation call failed — let user proceed anyway
    await saveWord(korean, english, sentence);
  } finally {
    btn.textContent = '新增單字';
    btn.disabled = false;
  }
}

function showValidationModal(v) {
  document.getElementById('validate-message').textContent = v.message;

  const orig = _pendingWord.original;
  const sugg = _pendingWord.suggested;

  // Show only rows where something actually changed
  setDiffRow('korean',   orig.korean,   sugg.korean,   orig.korean   !== sugg.korean);
  setDiffRow('meaning',  orig.english,  sugg.english,  orig.english  !== sugg.english);
  setDiffRow('sentence', orig.sentence, sugg.sentence,
    sugg.sentence && orig.sentence !== sugg.sentence);

  document.getElementById('validate-overlay').classList.remove('hidden');
}

function setDiffRow(field, orig, sugg, changed) {
  const row = document.getElementById(`diff-${field}-row`);
  if (!changed) { row.classList.add('hidden'); return; }
  row.classList.remove('hidden');
  document.getElementById(`diff-${field}-orig`).textContent = orig || '（空）';
  document.getElementById(`diff-${field}-sugg`).textContent = sugg || '（空）';
}

function dismissValidation() {
  document.getElementById('validate-overlay').classList.add('hidden');
  _pendingWord = null;
}

async function proceedWithOriginal() {
  const w = _pendingWord.original;
  dismissValidation();
  await saveWord(w.korean, w.english, w.sentence);
}

async function proceedWithSuggestion() {
  const w = _pendingWord.suggested;
  dismissValidation();
  // Fill inputs with suggested values so user can see what was used
  document.getElementById('word-korean').value = w.korean;
  document.getElementById('word-meaning').value = w.english;
  document.getElementById('word-sentence').value = w.sentence;
  await saveWord(w.korean, w.english, w.sentence);
}

async function saveWord(korean, english, sentence) {
  try {
    const data = await api('/word/add', {
      method: 'POST',
      body: { session_id: currentSession.id, korean, english, example_sentence: sentence }
    });

    document.getElementById('word-korean').value = '';
    document.getElementById('word-meaning').value = '';
    document.getElementById('word-sentence').value = '';
    document.getElementById('word-korean').focus();

    sessionWordCount++;
    updateWordCount();
    const list = document.getElementById('session-words');
    const div = document.createElement('div');
    div.innerHTML = wordItem({ id: data.word_id, korean, english, example_sentence_user: sentence }, true);
    list.prepend(div.firstChild);

    showToast(`已新增：${korean}`);
    pollAugmentation(data.word_id);
  } catch (e) { showToast('新增失敗，請重試'); }
}

async function pollAugmentation(wordId) {
  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    try {
      const data = await api(`/word/${wordId}/augmentation`);
      if (data.status === 'done') {
        const el = document.getElementById(`aug-status-${wordId}`);
        if (el) { el.textContent = '✓ AI 分析完成'; el.classList.add('done'); }
        return;
      }
    } catch (_) {}
  }
}

// ── Review ────────────────────────────────────────────────────────────────────
async function loadReviewQueue() {
  // Reset UI
  showOnly('review-loading');
  cardFlipped = false;
  mcAnswered = false;
  fbChecked = false;

  try {
    reviewQueue = await api('/review/queue');
    reviewIndex = 0;

    if (reviewQueue.length === 0) {
      showOnly('review-empty');
    } else {
      document.getElementById('review-loading').classList.add('hidden');
      showCard(reviewQueue[0]);
    }
  } catch (e) {
    showOnly('review-empty');
    console.error('loadReviewQueue', e);
  }
}

function showOnly(id) {
  ['review-loading', 'review-empty',
   'format-flashcard', 'format-fill-blank', 'format-multiple-choice'
  ].forEach(i => document.getElementById(i).classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function updateProgress() {
  const total = reviewQueue.length;
  document.getElementById('review-progress').textContent =
    `${reviewIndex + 1} / ${total}`;
}

function showCard(card) {
  currentCard = card;
  updateProgress();
  cardFlipped = false;
  mcAnswered = false;
  fbChecked = false;

  if (card.format === 'flashcard') showFlashcard(card);
  else if (card.format === 'fill_blank') showFillBlank(card);
  else showMultipleChoice(card);
}

// ── Flashcard ─────────────────────────────────────────────────────────────────
function showFlashcard(card) {
  showOnly('format-flashcard');
  document.getElementById('fc-korean').textContent = card.korean;
  document.getElementById('fc-meaning').textContent = card.english;

  const sentence = card.example_sentence_user ||
    (card.sentences && card.sentences[0] ? card.sentences[0].korean : '');
  document.getElementById('fc-sentence').textContent = sentence;

  const notes = card.usage_notes || '';
  const notesEl = document.getElementById('fc-notes');
  notesEl.textContent = notes;
  notesEl.style.display = notes ? 'block' : 'none';

  document.getElementById('fc-back').classList.add('hidden');
  document.getElementById('fc-front').classList.remove('hidden');
  document.getElementById('fc-buttons').classList.add('hidden');
}

function flipCard() {
  if (cardFlipped) return;
  cardFlipped = true;
  document.getElementById('fc-front').classList.add('hidden');
  document.getElementById('fc-back').classList.remove('hidden');
  document.getElementById('fc-buttons').classList.remove('hidden');
}

// ── Fill in blank ─────────────────────────────────────────────────────────────
function showFillBlank(card) {
  showOnly('format-fill-blank');
  document.getElementById('fb-meaning').textContent = card.english;

  const sentenceEl = document.getElementById('fb-sentence');
  if (card.example_sentence_user) {
    const blanked = card.example_sentence_user.replace(
      new RegExp(escapeRegex(card.korean), 'g'), '___'
    );
    sentenceEl.textContent = blanked;
    sentenceEl.style.display = 'block';
  } else {
    sentenceEl.style.display = 'none';
  }

  document.getElementById('fb-input').value = '';
  document.getElementById('fb-result').classList.add('hidden');
  document.getElementById('fb-buttons').classList.add('hidden');
  setTimeout(() => document.getElementById('fb-input').focus(), 300);
}

function checkFillBlank() {
  if (fbChecked) return;
  fbChecked = true;

  const input = document.getElementById('fb-input').value.trim();
  const correct = currentCard.korean.trim();
  const isCorrect = input === correct;

  const resultEl = document.getElementById('fb-result');
  resultEl.classList.remove('hidden', 'correct', 'wrong');
  resultEl.classList.add(isCorrect ? 'correct' : 'wrong');
  resultEl.textContent = isCorrect
    ? `✓ 正確！${correct}`
    : `✗ 正確答案：${correct}`;

  document.getElementById('fb-input').disabled = true;
  document.getElementById('fb-buttons').classList.remove('hidden');
}

// ── Multiple choice ───────────────────────────────────────────────────────────
function showMultipleChoice(card) {
  showOnly('format-multiple-choice');
  document.getElementById('mc-meaning').textContent = card.english;

  const container = document.getElementById('mc-options');
  container.innerHTML = card.options.map(opt =>
    `<button class="mc-option" onclick="selectMCOption(this, '${esc(opt.korean)}')">
       ${esc(opt.korean)}
     </button>`
  ).join('');

  document.getElementById('mc-buttons').classList.add('hidden');
}

function selectMCOption(btn, selected) {
  if (mcAnswered) return;
  mcAnswered = true;

  const correct = currentCard.korean;
  document.querySelectorAll('.mc-option').forEach(b => {
    b.disabled = true;
    if (b === btn) b.classList.add(selected === correct ? 'correct' : 'wrong');
    if (b.textContent.trim() === correct && selected !== correct) b.classList.add('correct');
  });

  document.getElementById('mc-buttons').classList.remove('hidden');
}

// ── Submit review result ──────────────────────────────────────────────────────
async function submitResult(result) {
  try {
    await api('/review/result', {
      method: 'POST',
      body: { word_id: currentCard.id, result }
    });
  } catch (e) { console.error('submitResult', e); }

  reviewIndex++;
  if (reviewIndex < reviewQueue.length) {
    showCard(reviewQueue[reviewIndex]);
  } else {
    showOnly('review-empty');
    document.getElementById('review-progress').textContent = '';
    loadDashboard();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
