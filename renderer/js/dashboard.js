const SAMPLE_KEYWORDS = [
  '자기계발', '아침루틴', '동기부여', '좋은습관', '성공마인드',
  '재테크입문', '적금추천', '절약생활', '월급관리', '사이드잡',
  '직장인공감', '번아웃극복', '워라밸', '퇴사고민', '커리어성장',
];

function renderKeywords() {
  const list = document.getElementById('keywordsList');
  list.innerHTML = SAMPLE_KEYWORDS.map(k =>
    `<span class="keyword-chip" onclick="useKeyword('${k}')">#${k}</span>`
  ).join('');
}

function useKeyword(keyword) {
  sessionStorage.setItem('selectedKeyword', keyword);
  api.navigate('write');
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
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

renderKeywords();
loadTodayPosts();
