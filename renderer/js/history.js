const STATUS_LABELS = { draft: '초안', scheduled: '예약됨', published: '발행완료', failed: '실패' };
const CATEGORY_LABELS = {
  daily: '일상', recipe: '요리', restaurant: '맛집',
  economy: '경제', book: '책', car: '자동차',
  pet: '반려동물', sports: '스포츠', other: '기타',
};
const CATEGORY_COLORS = {
  daily: '#f59e0b', recipe: '#10b981', restaurant: '#ef4444',
  economy: '#3b82f6', book: '#8b5cf6', car: '#6366f1',
  pet: '#ec4899', sports: '#f97316', other: '#6b7280',
};

let allPosts = [];
let currentFilter = 'all';
let currentPost = null;

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderList();
}

function getFiltered() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  return allPosts.filter(p => {
    if (currentFilter !== 'all' && p.status !== currentFilter) return false;
    if (q) {
      const haystack = `${p.title || ''} ${p.subject || ''}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function renderStats() {
  document.getElementById('statTotal').textContent = allPosts.length;
  document.getElementById('statPublished').textContent = allPosts.filter(p => p.status === 'published').length;
  document.getElementById('statDraft').textContent = allPosts.filter(p => p.status === 'draft').length;
  const totalViews = allPosts.reduce((s, p) => s + (p.views || 0), 0);
  document.getElementById('statViews').textContent = totalViews.toLocaleString();
}

function renderList() {
  const list = document.getElementById('historyList');
  const posts = getFiltered();

  if (!posts.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>${allPosts.length === 0 ? '아직 작성된 글이 없습니다.' : '해당하는 글이 없습니다.'}</p>
        ${allPosts.length === 0 ? '<button class="btn btn-primary" onclick="api.navigate(\'write\')">✨ 첫 글 작성하기</button>' : ''}
      </div>`;
    return;
  }

  list.innerHTML = posts.map(post => {
    const cat = post.category || 'other';
    const color = CATEGORY_COLORS[cat] || '#6b7280';
    const catLabel = CATEGORY_LABELS[cat] || cat;
    const styleLabel = post.style === 'emotional' ? '😊 감성체' : '📊 정보전달체';
    const hasUrl = post.naver_url && post.naver_url.trim();
    const hasPerf = post.views > 0 || post.likes > 0;

    return `
      <div class="history-item" onclick='openModal(${JSON.stringify(post).replace(/'/g, "&#39;")})'>
        <div>
          <div class="history-title">${post.title || '제목 없음'}</div>
          <div class="history-meta">
            <span><span class="cat-dot" style="background:${color};"></span>${catLabel}</span>
            <span>${post.subject || '-'}</span>
            <span>${styleLabel}</span>
            <span>${formatDate(post.created_at)}</span>
            ${hasPerf ? `<span>👁 ${post.views || 0} · ❤️ ${post.likes || 0}</span>` : ''}
          </div>
        </div>
        <div class="history-right">
          <span class="badge badge-${post.status}">${STATUS_LABELS[post.status] || post.status}</span>
          ${hasUrl ? `<a class="naver-link" onclick="event.stopPropagation(); api.openExternalUrl('${post.naver_url}')">네이버 보기 ↗</a>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function openModal(post) {
  currentPost = post;

  document.getElementById('modalTitle').textContent = post.title || '제목 없음';

  const badge = document.getElementById('modalBadge');
  badge.textContent = STATUS_LABELS[post.status] || post.status;
  badge.className = `badge badge-${post.status}`;

  document.getElementById('modalDate').textContent = `작성: ${formatDate(post.created_at)}`;

  const cat = post.category || 'other';
  document.getElementById('modalCategory').textContent =
    `${CATEGORY_LABELS[cat] || cat} · ${post.style === 'emotional' ? '감성체' : '정보전달체'}`;

  document.getElementById('modalSubject').textContent = post.subject || '-';
  document.getElementById('modalPerspective').textContent = post.perspective || '(AI 자동 결정)';

  const hashtagsWrap = document.getElementById('modalHashtagsWrap');
  const hashtagsEl = document.getElementById('modalHashtags');
  if (post.hashtags) {
    hashtagsEl.textContent = post.hashtags;
    hashtagsWrap.style.display = 'block';
  } else {
    hashtagsWrap.style.display = 'none';
  }

  document.getElementById('modalContent').textContent =
    post.processed_content || post.content || '내용 없음';

  const urlInput = document.getElementById('modalUrlInput');
  const openBtn = document.getElementById('modalOpenBtn');
  urlInput.value = post.naver_url || '';
  openBtn.style.display = post.naver_url ? 'inline-flex' : 'none';

  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('open');
  }
}

async function saveModalUrl() {
  if (!currentPost) return;
  const url = document.getElementById('modalUrlInput').value.trim();
  if (!url) { showToast('URL을 입력해주세요.', 'error'); return; }
  if (!url.startsWith('https://blog.naver.com/')) {
    showToast('올바른 네이버 블로그 URL을 입력해주세요.', 'error');
    return;
  }
  await api.updatePostUrl({ postId: currentPost.id, naverUrl: url });
  currentPost.naver_url = url;
  document.getElementById('modalOpenBtn').style.display = 'inline-flex';
  // 목록에도 반영
  const idx = allPosts.findIndex(p => p.id === currentPost.id);
  if (idx !== -1) allPosts[idx].naver_url = url;
  renderList();
  showToast('URL이 저장되었습니다.', 'success');
}

function openNaverUrl() {
  const url = document.getElementById('modalUrlInput').value.trim() || (currentPost && currentPost.naver_url);
  if (url) api.openExternalUrl(url);
}

async function loadHistory() {
  const res = await api.getHistory();
  if (!res.success) {
    document.getElementById('historyList').innerHTML =
      '<div class="empty-state"><p>이력을 불러오지 못했습니다.</p></div>';
    return;
  }
  allPosts = res.data || [];
  renderStats();
  renderList();
}

loadHistory();
