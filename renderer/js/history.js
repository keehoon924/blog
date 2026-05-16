const STATUS_LABELS = { draft: '초안', scheduled: '예약됨', published: '발행완료', failed: '실패' };

function formatDate(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function openModal(post) {
  document.getElementById('modalTitle').textContent = post.title || '제목 없음';
  document.getElementById('modalContent').textContent = post.processed_content || post.content || '내용 없음';
  const badge = document.getElementById('modalBadge');
  badge.textContent = STATUS_LABELS[post.status] || post.status;
  badge.className = `badge badge-${post.status}`;
  document.getElementById('modalDate').textContent = formatDate(post.created_at);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal(e) {
  if (e.target === document.getElementById('modalOverlay')) {
    document.getElementById('modalOverlay').classList.remove('open');
  }
}

async function loadHistory() {
  const list = document.getElementById('historyList');
  const res = await api.getHistory();

  if (!res.success || !res.data.length) {
    list.innerHTML = `
      <div class="empty-state">
        <p>아직 작성된 글이 없습니다.</p>
        <button class="btn btn-primary" onclick="api.navigate('write')">✨ 첫 글 작성하기</button>
      </div>`;
    return;
  }

  list.innerHTML = res.data.map(post => `
    <div class="history-item" onclick='openModal(${JSON.stringify(post).replace(/'/g, "&#39;")})'>
      <div>
        <div class="history-title">${post.title || '제목 없음'}</div>
        <div class="history-meta">
          <span>#${post.keyword || '-'}</span>
          <span>${post.style === 'emotional' ? '😊 감성체' : '📊 정보전달체'}</span>
          <span>${formatDate(post.created_at)}</span>
        </div>
      </div>
      <div class="history-right">
        <span class="badge badge-${post.status}">${STATUS_LABELS[post.status] || post.status}</span>
      </div>
    </div>
  `).join('');
}

loadHistory();
