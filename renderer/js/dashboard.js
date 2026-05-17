const CATEGORY_LABELS = {
  daily: '일상', recipe: '요리', restaurant: '맛집',
  economy: '경제', book: '책', car: '자동차',
  pet: '반려동물', sports: '스포츠', other: '기타',
};

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function useKeyword(keyword) {
  sessionStorage.setItem('selectedKeyword', keyword);
  api.navigate('write');
}

function renderKeywords(keywords, source) {
  const list = document.getElementById('keywordsList');
  const label = document.getElementById('keywordsLabel');

  if (source === 'datalab') {
    label.innerHTML = '🔥 실시간 트렌딩 키워드 <span style="font-size:11px; color:var(--muted);">(DataLab · 최근 7일)</span>';
  } else if (source === 'cache') {
    label.innerHTML = '🔥 트렌딩 키워드 <span style="font-size:11px; color:var(--muted);">(캐시)</span>';
  } else {
    label.innerHTML = '📋 추천 키워드 <span style="font-size:11px; color:var(--muted);">(DataLab 키 미설정 — 샘플)</span>';
  }

  list.innerHTML = keywords.map(k => {
    const catLabel = CATEGORY_LABELS[k.category] || k.category;
    return `<span class="keyword-chip" onclick="useKeyword('${k.keyword}')">
      <span style="font-size:10px; opacity:0.7;">${catLabel}</span> #${k.keyword}
    </span>`;
  }).join('');
}

async function loadKeywords(forceRefresh = false) {
  const list = document.getElementById('keywordsList');
  const label = document.getElementById('keywordsLabel');
  const refreshBtn = document.getElementById('keywordsRefreshBtn');

  label.innerHTML = '⏳ 키워드 불러오는 중...';
  list.innerHTML = '<span style="color:var(--muted); font-size:13px;">DataLab에서 데이터를 가져오고 있습니다...</span>';
  if (refreshBtn) refreshBtn.disabled = true;

  const res = await api.fetchKeywords({ forceRefresh });

  if (refreshBtn) refreshBtn.disabled = false;

  if (!res.success) {
    label.textContent = '⚠️ 키워드 로딩 실패';
    list.innerHTML = '<span style="color:var(--muted); font-size:13px;">잠시 후 다시 시도해주세요.</span>';
    return;
  }

  renderKeywords(res.keywords, res.source);
}

async function loadTodayPosts() {
  const res = await api.getHistory();
  if (!res.success) return;

  const today = new Date().toISOString().slice(0, 10);
  const todayPosts = res.data.filter(p => p.created_at && p.created_at.startsWith(today));

  const slots = [
    { label: '🌅 아침 (09:00)', time: '09' },
    { label: '☀️ 점심 (12:00)', time: '12' },
    { label: '🌆 저녁 (18:00)', time: '18' },
  ];

  const grid = document.getElementById('slotGrid');
  grid.innerHTML = slots.map((slot, i) => {
    const post = todayPosts[i];
    return `
      <div class="slot-card">
        <div class="slot-time">${slot.label}</div>
        ${post
          ? `<div class="slot-title">${post.title || '제목 없음'}</div>
             <span class="badge badge-${post.status}">${statusLabel(post.status)}</span>`
          : `<div class="slot-title slot-empty">비어있음</div>
             <button class="btn btn-outline btn-sm" onclick="api.navigate('write')">+ 글쓰기</button>`
        }
      </div>
    `;
  }).join('');
}

function statusLabel(status) {
  const map = { draft: '초안', scheduled: '예약됨', published: '발행완료', failed: '실패' };
  return map[status] || status;
}

// ─── 완전자동 모드 ────────────────────────────────────────────────────────────

const CAT_LABELS = {
  daily: '일상', recipe: '요리', restaurant: '맛집',
  economy: '경제', book: '책', car: '자동차',
  pet: '반려동물', sports: '스포츠', other: '기타',
};

function nextOccurrence(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const diff = target - now;
  const hours = Math.floor(diff / 3600000);
  const mins  = Math.floor((diff % 3600000) / 60000);
  const isToday = target.getDate() === now.getDate();
  return isToday ? `오늘 ${timeStr} (${hours}시간 ${mins}분 후)` : `내일 ${timeStr}`;
}

function applyAutoModeUI(status) {
  const card    = document.getElementById('autoCard');
  const btn     = document.getElementById('autoToggleBtn');
  const enabled = status.autoMode;

  btn.textContent = enabled ? 'ON' : 'OFF';
  btn.className   = `auto-toggle ${enabled ? 'on' : 'off'}`;
  card.className  = `auto-card${enabled ? ' active' : ''}`;

  const slots = [
    { catEl: 'slotMorning', nextEl: 'slotMorningNext', time: status.morningTime, cat: status.morningCategory },
    { catEl: 'slotLunch',   nextEl: 'slotLunchNext',   time: status.lunchTime,   cat: status.lunchCategory   },
    { catEl: 'slotEvening', nextEl: 'slotEveningNext', time: status.eveningTime, cat: status.eveningCategory  },
  ];
  for (const s of slots) {
    document.getElementById(s.catEl).textContent  = `${s.time} · ${CAT_LABELS[s.cat] || s.cat}`;
    document.getElementById(s.nextEl).textContent = enabled ? nextOccurrence(s.time) : '예약 없음';
  }
}

async function loadAutoModeStatus() {
  const res = await api.getSchedulerStatus();
  if (res.success) applyAutoModeUI(res.data);
}

async function toggleAutoMode() {
  const btn     = document.getElementById('autoToggleBtn');
  const enabled = btn.textContent === 'OFF'; // flip
  const res     = await api.setAutoMode(enabled);
  if (res.success) {
    const statusRes = await api.getSchedulerStatus();
    if (statusRes.success) applyAutoModeUI(statusRes.data);
    showToast(enabled ? '완전자동 모드가 켜졌습니다.' : '완전자동 모드가 꺼졌습니다.', 'success');
  } else {
    showToast(res.error || '설정 실패', 'error');
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

loadTodayPosts();
loadKeywords();
loadAutoModeStatus();
