// 수동 예약 발행 화면 — 글 파일 드래그 + 이미지 슬롯 + 일괄 예약
const cards = []; // [{ id, filename, parsed, images: [path...], scheduledDate, scheduledHour, scheduledMinute }]

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function uniqueId() { return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// 기본 발행 시간: 내일 07:00
function defaultSchedule(offsetHours = 0) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7 + offsetHours, 0, 0, 0);
  return {
    date: d.toISOString().slice(0, 10), // YYYY-MM-DD
    hour: String(d.getHours()).padStart(2, '0'),
    minute: '00',
  };
}

function escapeHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightMarkers(text) {
  return escapeHtml(text)
    .replace(/\[이미지\]/g, '<span class="marker">[이미지]</span>')
    .replace(/\[인용구:[^\]]+\]/g, m => `<span class="marker">${m}</span>`);
}

function renderCard(card) {
  const p = card.parsed;
  const errorHtml = p.errors.length
    ? p.errors.map(e => `<span class="meta-badge error">⚠ ${escapeHtml(e)}</span>`).join('')
    : '';
  const warnHtml = p.warnings.length
    ? p.warnings.map(w => `<span class="meta-badge warn">${escapeHtml(w)}</span>`).join('')
    : '';

  // 이미지 슬롯 (썸네일 포함)
  const slotsHtml = Array.from({ length: p.imageMarkerCount }, (_, idx) => {
    const img = card.images[idx]; // { path, dataUrl, filename } or null
    const filled = !!img;
    const thumbHtml = filled && img.dataUrl
      ? `<img src="${img.dataUrl}" class="img-slot-thumb" alt=""/>`
      : '';
    const label = filled ? escapeHtml(img.filename || '') : '+ 클릭해서 추가';
    return `
      <div class="img-slot ${filled ? 'filled' : ''}"
           data-card-id="${card.id}" data-slot-idx="${idx}"
           onclick="handleImageSlotClick('${card.id}', ${idx})"
           ondragover="event.preventDefault(); this.classList.add('dragover');"
           ondragleave="this.classList.remove('dragover');"
           ondrop="handleImageSlotDrop(event, '${card.id}', ${idx})">
        <div class="img-slot-idx">${idx + 1}번 마커</div>
        ${thumbHtml}
        <div class="img-slot-name">${label}</div>
      </div>
    `;
  }).join('');

  const slotsBlock = p.imageMarkerCount > 0
    ? `<div class="card-section">
         <div class="card-section-label">📷 이미지 (본문 [이미지] 마커 ${p.imageMarkerCount}개)</div>
         <div class="img-slots">${slotsHtml}</div>
       </div>`
    : `<div class="card-section">
         <div class="card-section-label">📷 이미지 없음 (본문에 [이미지] 마커 없음)</div>
       </div>`;

  return `
    <div class="post-card ${p.errors.length ? 'has-error' : ''}" data-card-id="${card.id}">
      <div class="card-header">
        <div class="card-filename">📄 ${escapeHtml(card.filename)}</div>
        <button class="card-remove" onclick="removeCard('${card.id}')">✕ 제거</button>
      </div>

      <input type="text" class="card-title-input" value="${escapeHtml(p.title)}"
             oninput="updateCardTitle('${card.id}', this.value)" placeholder="제목"/>

      <div class="meta-row">
        <span class="meta-badge">${p.charCount}자 (공백 제외)</span>
        <span class="meta-badge">마커 ${p.imageMarkerCount}개</span>
        ${errorHtml}${warnHtml}
      </div>

      ${slotsBlock}

      <div class="card-section">
        <div class="card-section-label">📁 네이버 카테고리 (정확한 이름, 비우면 마지막 사용 카테고리)</div>
        <input type="text" class="card-cat-input" value="${escapeHtml(card.naverCategory || '')}"
               placeholder="예: 일상, 맛집, 친구가 건네는 말 (정확한 이름)"
               oninput="updateCardCategory('${card.id}', this.value)"/>
      </div>

      <div class="card-section">
        <div class="card-section-label">📅 발행 시간 (분은 10분 단위만 가능)</div>
        <div class="schedule-row">
          <input type="date" value="${card.scheduledDate}" min="${new Date().toISOString().slice(0,10)}"
                 onchange="updateCardSchedule('${card.id}', 'date', this.value)"/>
          <select onchange="updateCardSchedule('${card.id}', 'hour', this.value)">
            ${Array.from({ length: 24 }, (_, i) => {
              const v = String(i).padStart(2, '0');
              return `<option value="${v}" ${v === card.scheduledHour ? 'selected' : ''}>${v}시</option>`;
            }).join('')}
          </select>
          <select onchange="updateCardSchedule('${card.id}', 'minute', this.value)">
            ${['00','10','20','30','40','50'].map(v =>
              `<option value="${v}" ${v === card.scheduledMinute ? 'selected' : ''}>${v}분</option>`
            ).join('')}
          </select>
        </div>
      </div>

      <div class="card-section">
        <div class="card-section-label">📝 본문 미리보기 (마커 강조)</div>
        <div class="body-preview">${highlightMarkers(p.body)}</div>
        ${p.hashtags ? `<div class="hashtag-preview">${escapeHtml(p.hashtags)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderAll() {
  const list = document.getElementById('cardList');
  const empty = document.getElementById('emptyState');
  if (cards.length === 0) {
    list.innerHTML = '';
    list.appendChild(empty);
    empty.style.display = '';
    document.getElementById('publishAllBtn').disabled = true;
    document.getElementById('cardCount').textContent = '';
  } else {
    empty.style.display = 'none';
    list.innerHTML = cards.map(renderCard).join('');
    document.getElementById('publishAllBtn').disabled = false;
    document.getElementById('cardCount').textContent = `${cards.length}개 글`;
  }
}

async function addFileFromText(text, filename) {
  const res = await api.manualParseContent({ text, filename });
  if (!res.success) {
    showToast(`${filename} 파싱 실패: ${res.error}`, 'error');
    return;
  }
  const def = defaultSchedule(cards.length);  // 카드 1개당 1시간씩 자동 분배
  cards.push({
    id: uniqueId(),
    filename,
    parsed: res.data,
    images: new Array(res.data.imageMarkerCount).fill(null),
    naverCategory: res.data.naverCategory || '', // 파일에서 "카테고리:" 줄 추출
    scheduledDate: def.date,
    scheduledHour: def.hour,
    scheduledMinute: def.minute,
  });
  renderAll();
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (!/\.(txt|md)$/i.test(file.name)) {
      showToast(`${file.name} — .txt / .md 파일만 가능`, 'error');
      continue;
    }
    const text = await file.text();
    await addFileFromText(text, file.name);
  }
}

function removeCard(id) {
  const idx = cards.findIndex(c => c.id === id);
  if (idx !== -1) cards.splice(idx, 1);
  renderAll();
}

function updateCardTitle(id, value) {
  const card = cards.find(c => c.id === id);
  if (card) card.parsed.title = value;
}

function updateCardSchedule(id, field, value) {
  const card = cards.find(c => c.id === id);
  if (!card) return;
  if (field === 'date') card.scheduledDate = value;
  else if (field === 'hour') card.scheduledHour = value;
  else if (field === 'minute') card.scheduledMinute = value;
}

function updateCardCategory(id, value) {
  const card = cards.find(c => c.id === id);
  if (card) card.naverCategory = value;
}

async function setImageWithThumbnail(card, slotIdx, imagePath) {
  const filename = imagePath.split(/[\\/]/).pop();
  const thumb = await api.manualReadImageThumbnail(imagePath);
  card.images[slotIdx] = {
    path: imagePath,
    dataUrl: thumb.success ? thumb.dataUrl : null,
    filename,
  };
  renderAll();
}

async function handleImageSlotClick(cardId, slotIdx) {
  const res = await api.manualSelectImage();
  if (!res.success) {
    if (!res.canceled) showToast(`이미지 선택 실패: ${res.error}`, 'error');
    return;
  }
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  await setImageWithThumbnail(card, slotIdx, res.path);
}

async function handleImageSlotDrop(event, cardId, slotIdx) {
  event.preventDefault();
  event.target.closest('.img-slot').classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (!file) return;
  // Electron drag-drop은 file.path 노출 (sandbox:false 환경에서)
  const filePath = file.path;
  if (!filePath) {
    showToast('드래그로 추가 안 됨 — 클릭해서 선택해주세요', 'error');
    return;
  }
  if (!/\.(jpe?g|png|gif|bmp|heic|heif|webp)$/i.test(file.name)) {
    showToast('지원 형식: jpg/png/gif/bmp/heic/heif/webp', 'error');
    return;
  }
  const card = cards.find(c => c.id === cardId);
  if (!card) return;
  await setImageWithThumbnail(card, slotIdx, filePath);
}

function clearAll() {
  if (cards.length === 0) return;
  if (!confirm(`${cards.length}개 글을 전부 제거합니다. 계속할까요?`)) return;
  cards.length = 0;
  renderAll();
  document.getElementById('progressLog').style.display = 'none';
  document.getElementById('progressLog').innerHTML = '';
}

function validateBeforePublish() {
  const errors = [];
  for (const c of cards) {
    const label = c.filename;
    if (c.parsed.errors.length) errors.push(`${label}: ${c.parsed.errors.join(', ')}`);
    if (!c.parsed.title || !c.parsed.title.trim()) errors.push(`${label}: 제목 없음`);
    // 이미지 슬롯 미채움 체크 (객체 또는 null)
    const missing = c.images.filter(img => !img || !img.path).length;
    if (missing > 0) errors.push(`${label}: 이미지 ${missing}개 누락 (마커 ${c.parsed.imageMarkerCount}개)`);
    // 예약 시간이 과거인지 체크
    const dt = new Date(`${c.scheduledDate}T${c.scheduledHour}:${c.scheduledMinute}:00`);
    if (isNaN(dt.getTime())) errors.push(`${label}: 예약 시간 형식 오류`);
    else if (dt.getTime() < Date.now() + 60000) errors.push(`${label}: 예약 시간이 너무 가까움 (최소 1분 후)`);
  }
  return errors;
}

function logProgress(html) {
  const log = document.getElementById('progressLog');
  log.style.display = 'block';
  log.innerHTML += html + '<br>';
  log.scrollTop = log.scrollHeight;
}

async function handlePublishAll() {
  const errors = validateBeforePublish();
  if (errors.length) {
    showToast(`검증 실패: ${errors.length}건`, 'error');
    document.getElementById('progressLog').style.display = 'block';
    document.getElementById('progressLog').innerHTML = errors.map(e => `<span class="fail">✗ ${escapeHtml(e)}</span>`).join('<br>');
    return;
  }

  if (!confirm(`${cards.length}개 글을 네이버에 예약 등록합니다.\n진행하면 글당 2~3분이 걸리고, 네이버 에디터 창이 자동으로 열리고 닫힙니다. 계속할까요?`)) return;

  document.getElementById('publishAllBtn').disabled = true;
  document.getElementById('progressLog').innerHTML = '';
  logProgress(`<b>📤 ${cards.length}개 글 예약 등록 시작</b>`);

  const posts = cards.map(c => ({
    filename: c.filename,
    title: c.parsed.title,
    body: c.parsed.body,
    hashtags: c.parsed.hashtags,
    images: c.images.map(img => img ? img.path : null), // 객체 → 경로 문자열만 전송
    naverCategory: c.naverCategory || '',
    scheduledAt: new Date(`${c.scheduledDate}T${c.scheduledHour}:${c.scheduledMinute}:00`).toISOString(),
  }));

  const res = await api.manualPublishAll({ posts });
  if (!res.success) {
    logProgress(`<span class="fail">✗ 전체 실패: ${escapeHtml(res.error || '알 수 없는 오류')}</span>`);
    showToast('예약 등록 실패', 'error');
  } else {
    const okCount = res.results.filter(r => r.success).length;
    const failCount = res.results.length - okCount;
    logProgress(`<b>✅ 완료: 성공 ${okCount}개 / 실패 ${failCount}개</b>`);
    res.results.forEach(r => {
      if (r.success) logProgress(`<span class="ok">✓ ${escapeHtml(r.filename)}</span>`);
      else          logProgress(`<span class="fail">✗ ${escapeHtml(r.filename)} — ${escapeHtml(r.error)}</span>`);
    });
    showToast(`완료: ${okCount}/${res.results.length}`, okCount === res.results.length ? 'success' : 'error');
  }

  document.getElementById('publishAllBtn').disabled = false;
}

// ── 진행 이벤트 수신 ──
if (api.onManualProgress) {
  api.onManualProgress((info) => {
    const { index, total, label, status, error } = info;
    if (status === 'publishing') logProgress(`▶ [${index + 1}/${total}] ${escapeHtml(label)} 발행 중...`);
    else if (status === 'done')  logProgress(`<span class="ok">  ✓ 완료</span>`);
    else if (status === 'failed') logProgress(`<span class="fail">  ✗ 실패: ${escapeHtml(error || '')}</span>`);
  });
}

// ── 드래그 드롭 이벤트 ──
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');

dropZone.addEventListener('click', (e) => {
  if (e.target.id === 'fileBrowseBtn') return;
  fileInput.click();
});
document.getElementById('fileBrowseBtn').addEventListener('click', (e) => {
  e.preventDefault();
  fileInput.click();
});
fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  e.target.value = '';
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  handleFiles(e.dataTransfer.files);
});

// 페이지 전체에서 발생하는 기본 드래그 동작 막기 (의도 외 파일 열림 방지)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

renderAll();
