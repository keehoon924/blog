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

loadTodayPosts();
loadKeywords();
