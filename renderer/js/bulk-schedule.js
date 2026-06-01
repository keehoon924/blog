/**
 * bulk-schedule.js — 일괄 예약 발행 UI 로직
 */

let parsedPosts = [];
let isRunning   = false;

// ── 파일 드래그앤드롭 ──────────────────────────────────────────────────────────
const uploadZone = document.getElementById('upload-zone');
const fileInput  = document.getElementById('file-input');

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) readFile(file);
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) readFile(e.target.files[0]);
});

function readFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => processText(e.target.result, file.name);
  reader.readAsText(file, 'utf-8');
}

// ── 파싱 및 화면 렌더링 ───────────────────────────────────────────────────────
async function processText(text, filename) {
  const result = await api.bulkParseText(text);
  if (result.error) {
    alert('파싱 오류: ' + result.error);
    return;
  }
  parsedPosts = result.posts;
  if (parsedPosts.length === 0) {
    alert('글을 찾을 수 없습니다. 양식(===글시작=== / ===글끝===)을 확인해주세요.');
    return;
  }
  renderSummary();
  renderTable();
  document.getElementById('opt-start-from').max = parsedPosts.length;
  document.getElementById('action-bar').style.display = 'block';
}

function renderSummary() {
  const dates = [...new Set(parsedPosts.map(p => p.date))].sort();
  document.getElementById('sum-total').textContent = parsedPosts.length;
  document.getElementById('sum-days').textContent  = dates.length;
  document.getElementById('sum-from').textContent  = dates[0] || '-';
  document.getElementById('sum-to').textContent    = dates[dates.length - 1] || '-';
  document.getElementById('summary-bar').style.display = 'flex';
}

function slotBadge(time) {
  const h = parseInt(time.split(':')[0], 10);
  if (h < 10) return '<span class="badge badge-morning">아침</span>';
  if (h < 15) return '<span class="badge badge-lunch">점심</span>';
  return '<span class="badge badge-evening">저녁</span>';
}

function renderTable() {
  const tbody = document.getElementById('post-table-body');
  tbody.innerHTML = parsedPosts.map((p, i) => `
    <tr id="row-${i}">
      <td>${i + 1}</td>
      <td>${p.date}</td>
      <td>${p.time}</td>
      <td>${slotBadge(p.time)}</td>
      <td>${esc(p.category)}</td>
      <td>${esc(p.title)}</td>
      <td><button class="btn-preview" onclick="showPreview(${i})">미리보기</button></td>
    </tr>
  `).join('');
  document.getElementById('table-wrap').style.display = 'block';
}

function esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── 미리보기 모달 ─────────────────────────────────────────────────────────────
function showPreview(idx) {
  const p = parsedPosts[idx];
  document.getElementById('modal-title').textContent = p.title;
  document.getElementById('modal-meta').innerHTML = `
    <b>날짜:</b> ${p.date} &nbsp; <b>시간:</b> ${p.time}<br>
    <b>카테고리:</b> ${esc(p.category)}<br>
    <b>태그:</b> ${esc(p.tags)}
  `;
  // 이미지 마커 하이라이트
  const contentHtml = esc(p.content)
    .replace(/\[이미지\]/g, '<span class="img-marker">[이미지]</span>');
  document.getElementById('modal-content').innerHTML = contentHtml;
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay') || !e.target) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

// ── 전체 예약 등록 실행 ───────────────────────────────────────────────────────
async function startBulk() {
  if (isRunning) return;
  if (parsedPosts.length === 0) { alert('먼저 파일을 업로드하세요.'); return; }

  const startFrom = Math.max(1, parseInt(document.getElementById('opt-start-from').value, 10)) - 1;
  const todo = parsedPosts.slice(startFrom);
  const total = todo.length;

  if (!confirm(`${startFrom + 1}번부터 총 ${total}개 글을 예약 등록합니다.\n완료까지 약 ${Math.round(total * 2.5)}분 소요됩니다.\n\n시작하시겠습니까?`)) return;

  isRunning = true;
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-start').textContent = '진행 중...';
  document.getElementById('progress-wrap').classList.add('show');

  let doneCount = 0;

  // 진행 이벤트 수신
  api.onBulkProgress((info) => {
    const abs = startFrom + info.index;       // 전체 기준 번호
    const row = document.getElementById(`row-${abs}`);

    if (info.status === 'start') {
      addLog(`[${abs + 1}/${parsedPosts.length}] 시작: ${info.title}`, 'info');
      if (row) row.style.background = '#fffde7';
    } else if (info.status === 'done') {
      doneCount++;
      addLog(`[${abs + 1}] ✅ 완료: ${info.title}`);
      if (row) row.style.background = '#e8f5e9';
      updateProgress(doneCount, total);
    } else if (info.status === 'error') {
      addLog(`[${abs + 1}] ❌ 오류: ${info.title} — ${info.error}`, 'err');
      if (row) row.style.background = '#ffeaea';
    } else if (info.status === 'all_done') {
      addLog(`\n🎉 전체 ${total}개 예약 등록 완료!`);
      isRunning = false;
      document.getElementById('btn-start').disabled = false;
      document.getElementById('btn-start').textContent = '전체 예약 등록 시작';
    }
  });

  await api.bulkRunAll({ posts: todo, startIndex: startFrom });
}

function updateProgress(done, total) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('prog-text').textContent  = `${done} / ${total}`;
  document.getElementById('prog-pct').textContent   = `${pct}%`;
  document.getElementById('prog-bar').style.width   = pct + '%';
}

function addLog(msg, type = '') {
  const log = document.getElementById('prog-log');
  const span = document.createElement('div');
  span.className = type === 'err' ? 'log-err' : type === 'info' ? 'log-info' : '';
  span.textContent = msg;
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}
