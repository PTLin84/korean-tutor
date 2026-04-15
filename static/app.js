// ── State ────────────────────────────────────────────────────────────────────
let currentSession = null;   // { id, date, notes }
let sessionWordCount = 0;

let reviewQueue = [];
let reviewIndex = 0;
let currentCard = null;
let cardFlipped = false;
let mcAnswered = false;
let fbChecked = false;

// Word bank
let wbPage = 1;
let wbTotal = 0;
let wbHasMore = false;
let wbSearch = '';
let wbSearchTimer = null;
let wbExpandedId = null;

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
  if (view === 'words')     initWordBank();
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

// ── Word bank ─────────────────────────────────────────────────────────────────

function initWordBank() {
  wbPage = 1;
  wbSearch = document.getElementById('words-search').value.trim();
  wbExpandedId = null;
  document.getElementById('words-list').innerHTML = '';
  document.getElementById('words-load-more').classList.add('hidden');
  document.getElementById('words-empty').classList.add('hidden');
  document.getElementById('words-loading').classList.remove('hidden');
  fetchWords(true);
}

async function fetchWords(replace = false) {
  try {
    const params = new URLSearchParams({ page: wbPage, limit: 30 });
    if (wbSearch) params.set('search', wbSearch);
    const data = await api(`/words?${params}`);

    wbTotal   = data.total;
    wbHasMore = data.has_more;

    document.getElementById('words-loading').classList.add('hidden');
    document.getElementById('words-total-label').textContent =
      wbSearch ? `${data.total} 個結果` : `共 ${data.total} 個單字`;

    const list = document.getElementById('words-list');
    if (replace) list.innerHTML = '';

    if (data.words.length === 0 && replace) {
      document.getElementById('words-empty').classList.remove('hidden');
      document.getElementById('words-load-more').classList.add('hidden');
      return;
    }

    data.words.forEach(w => {
      const el = document.createElement('div');
      el.innerHTML = wbCard(w);
      list.appendChild(el.firstChild);
    });

    attachSwipeListeners();

    // Load more button
    const lmBtn = document.getElementById('words-load-more');
    if (wbHasMore) {
      const remaining = wbTotal - wbPage * 30;
      document.getElementById('words-remaining').textContent = remaining;
      lmBtn.classList.remove('hidden');
    } else {
      lmBtn.classList.add('hidden');
    }
  } catch (e) {
    document.getElementById('words-loading').classList.add('hidden');
    console.error('fetchWords error', e);
  }
}

async function loadMoreWords() {
  wbPage++;
  document.getElementById('words-load-more').classList.add('hidden');
  await fetchWords(false);
}

function onWordsSearch() {
  clearTimeout(wbSearchTimer);
  wbSearchTimer = setTimeout(() => {
    wbPage = 1;
    wbSearch = document.getElementById('words-search').value.trim();
    document.getElementById('words-loading').classList.remove('hidden');
    document.getElementById('words-empty').classList.add('hidden');
    fetchWords(true);
  }, 350);
}

function toggleWordDetail(id) {
  if (suppressNextClick) { suppressNextClick = false; return; }
  const detail = document.getElementById(`wb-detail-${id}`);
  const arrow  = document.getElementById(`wb-arrow-${id}`);
  if (!detail) return;

  const isOpen = !detail.classList.contains('hidden');
  // Close previously open card
  if (wbExpandedId && wbExpandedId !== id) {
    const prev = document.getElementById(`wb-detail-${wbExpandedId}`);
    const prevArrow = document.getElementById(`wb-arrow-${wbExpandedId}`);
    if (prev) prev.classList.add('hidden');
    if (prevArrow) prevArrow.textContent = '›';
  }

  if (isOpen) {
    detail.classList.add('hidden');
    arrow.textContent = '›';
    wbExpandedId = null;
  } else {
    snapCardClosed(id);
    detail.classList.remove('hidden');
    arrow.textContent = '⌄';
    wbExpandedId = id;
  }
}

function wbSrsBadge(label) {
  if (!label) return '';
  if (label === 'overdue')   return '<span class="srs-badge srs-overdue">⚠️ 已逾期</span>';
  if (label === 'today')     return '<span class="srs-badge srs-today">📅 今日到期</span>';
  const days = parseInt(label.replace('in_', ''));
  if (days === 1)            return '<span class="srs-badge srs-soon">明天複習</span>';
  return `<span class="srs-badge srs-future">${days} 天後複習</span>`;
}

function wbCard(w) {
  const badge    = wbSrsBadge(w.srs_label);
  const date     = w.session_date ? `<span class="wb-date">${w.session_date}</span>` : '';
  const hasAug   = w.usage_notes || (w.sentences && w.sentences.length);

  const sentences = (w.sentences || []).map(s =>
    `<div class="wb-sentence">
       <div class="wb-sentence-korean">${esc(s.korean)}</div>
       <div class="wb-sentence-chinese">${esc(s.chinese)}</div>
     </div>`
  ).join('');

  const usageNotes = w.usage_notes
    ? `<div class="wb-section-title">使用說明</div>
       <div class="wb-section-body">${esc(w.usage_notes)}</div>` : '';

  const related = (w.related_words || []).length
    ? `<div class="wb-section-title">相關詞</div>
       <div class="wb-related">${w.related_words.map(r =>
           `<span class="wb-related-chip">${esc(r.korean)} ${esc(r.chinese)}</span>`
         ).join('')}</div>` : '';

  const mistakes = w.common_mistakes
    ? `<div class="wb-section-title">常見錯誤</div>
       <div class="wb-section-body">${esc(w.common_mistakes)}</div>` : '';

  const detail = hasAug
    ? `<div class="wb-detail hidden" id="wb-detail-${w.id}">
         ${sentences ? `<div class="wb-section-title">例句</div>${sentences}` : ''}
         ${usageNotes}${related}${mistakes}
       </div>` : '';

  return `<div class="wb-row" id="wb-row-${w.id}">
    <div class="wb-delete-bg">
      <button class="wb-delete-btn" onclick="confirmDeleteWord(${w.id}, '${esc(w.korean)}')">
        刪除
      </button>
    </div>
    <div class="wb-card" id="wb-card-${w.id}" onclick="toggleWordDetail(${w.id})">
      <div class="wb-card-main">
        <div class="wb-card-left">
          <div class="wb-korean">${esc(w.korean)}</div>
          <div class="wb-meaning">${esc(w.english)}</div>
          <div class="wb-meta">${date}${badge}</div>
        </div>
        <div class="wb-arrow" id="wb-arrow-${w.id}">${hasAug ? '›' : ''}</div>
      </div>
      ${detail}
    </div>
  </div>`;
}

// ── Swipe-to-delete ───────────────────────────────────────────────────────────

const SWIPE_REVEAL   = 80;   // px left to lock card open
const SWIPE_MIN_MOVE = 10;   // px horizontal before it's treated as a swipe

let swipeState = null;        // active touch/drag state
let openSwipeId = null;       // word id whose card is currently swiped open
let suppressNextClick = false; // true after a real swipe to cancel the trailing click

// Attach swipe listeners after cards are rendered
function attachSwipeListeners() {
  document.querySelectorAll('.wb-card[id^="wb-card-"]').forEach(card => {
    const id = parseInt(card.id.replace('wb-card-', ''));
    // Avoid double-binding
    if (card.dataset.swipeBound) return;
    card.dataset.swipeBound = '1';

    // Touch
    card.addEventListener('touchstart',  e => swipeStart(e, id, e.touches[0].clientX), { passive: true });
    card.addEventListener('touchmove',   e => swipeMove(e, id, e.touches[0].clientX),  { passive: false });
    card.addEventListener('touchend',    e => swipeEnd(id));

    // Mouse (desktop)
    card.addEventListener('mousedown',   e => swipeStart(e, id, e.clientX));
    card.addEventListener('mousemove',   e => swipeMove(e, id, e.clientX));
    card.addEventListener('mouseup',     e => swipeEnd(id));
    card.addEventListener('mouseleave',  e => swipeEnd(id));
  });

  // Tap anywhere outside an open card to close it
  document.addEventListener('click', closeOpenSwipe, { capture: true });
}

function swipeStart(e, id, clientX) {
  if (id === wbExpandedId) return;
  swipeState = { id, startX: clientX, currentX: clientX, isSwiping: false };
}

function swipeMove(e, id, clientX) {
  if (!swipeState || swipeState.id !== id) return;
  const dx = clientX - swipeState.startX;
  swipeState.currentX = clientX;

  // Only start swiping once past the minimum horizontal movement
  if (!swipeState.isSwiping && Math.abs(dx) < SWIPE_MIN_MOVE) return;
  swipeState.isSwiping = true;

  // Only allow leftward swipe
  const offset = Math.min(0, dx);
  const card = document.getElementById(`wb-card-${id}`);
  if (!card) return;

  // Prevent page scroll while swiping horizontally
  if (e.cancelable) e.preventDefault();

  card.style.transition = 'none';
  card.style.transform  = `translateX(${offset}px)`;
}

function swipeEnd(id) {
  if (!swipeState || swipeState.id !== id) return;
  const dx = swipeState.currentX - swipeState.startX;
  const wasSwiping = swipeState.isSwiping;
  swipeState = null;

  if (wasSwiping) suppressNextClick = true;

  const card = document.getElementById(`wb-card-${id}`);
  if (!card) return;
  card.style.transition = '';

  if (dx < -SWIPE_REVEAL) {
    // Lock open — close any other open card first
    if (openSwipeId && openSwipeId !== id) snapCardClosed(openSwipeId);
    openSwipeId = id;
    card.style.transform = `translateX(-${SWIPE_REVEAL}px)`;
  } else {
    snapCardClosed(id);
  }
}

function snapCardClosed(id) {
  const card = document.getElementById(`wb-card-${id}`);
  if (!card) return;
  card.style.transition = 'transform 0.2s ease';
  card.style.transform  = 'translateX(0)';
  if (openSwipeId === id) openSwipeId = null;
}

function closeOpenSwipe(e) {
  if (!openSwipeId) return;
  const row = document.getElementById(`wb-row-${openSwipeId}`);
  // If click is inside the open card's row, let the event through (e.g. delete button)
  if (row && row.contains(e.target)) return;
  snapCardClosed(openSwipeId);
}

async function confirmDeleteWord(id, korean) {
  // Close the swipe reveal
  snapCardClosed(id);

  try {
    await api(`/word/${id}`, { method: 'DELETE' });

    // Animate row out then remove it
    const row = document.getElementById(`wb-row-${id}`);
    if (row) {
      row.style.transition = 'opacity 0.25s, max-height 0.3s';
      row.style.overflow   = 'hidden';
      row.style.opacity    = '0';
      row.style.maxHeight  = row.offsetHeight + 'px';
      setTimeout(() => { row.style.maxHeight = '0'; }, 50);
      setTimeout(() => { row.remove(); updateWbTotalAfterDelete(); }, 350);
    }

    showToast(`已刪除：${korean}`);
  } catch (e) {
    showToast('刪除失敗，請重試');
  }
}

function updateWbTotalAfterDelete() {
  wbTotal = Math.max(0, wbTotal - 1);
  document.getElementById('words-total-label').textContent =
    wbSearch ? `${wbTotal} 個結果` : `共 ${wbTotal} 個單字`;
}
