let selectedStyle = 'emotional';
let currentPostId = null;
let currentHashtags = '';

function selectStyle(btn) {
  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedStyle = btn.dataset.style;
}

function setStatus(msg, loading = false) {
  const el = document.getElementById('statusMsg');
  el.innerHTML = loading ? `<span class="spinner"></span> ${msg}` : msg;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function calcSeoScore(keyword, title, content) {
  if (!keyword || !title || !content) return 0;
  let score = 0;
  const kw = keyword.toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  // Title contains keyword (30pt)
  if (titleLower.includes(kw)) score += 30;
  // Title length 15~25 (15pt)
  if (title.length >= 15 && title.length <= 25) score += 15;
  // Keyword in first 100 chars of content (20pt)
  if (contentLower.slice(0, 100).includes(kw)) score += 20;
  // Keyword appears 3+ times in content (20pt)
  const kwCount = (contentLower.match(new RegExp(kw, 'g')) || []).length;
  if (kwCount >= 3) score += 20; else if (kwCount >= 1) score += 10;
  // Content length 1500+ chars (15pt)
  const textLen = content.replace(/\[이미지:[^\]]*\]/g, '').length;
  if (textLen >= 1500) score += 15; else if (textLen >= 800) score += 8;

  return Math.min(score, 100);
}

function updateSeoScore() {
  const keyword = document.getElementById('keywordInput').value.trim();
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  const score = calcSeoScore(keyword, title, content);

  const el = document.getElementById('seoScore');
  if (!title && !content) { el.className = 'seo-score'; return; }

  if (score >= 75) {
    el.className = 'seo-score good';
    el.textContent = `SEO ${score}점 ✓ 좋음`;
  } else if (score >= 45) {
    el.className = 'seo-score medium';
    el.textContent = `SEO ${score}점 보통`;
  } else {
    el.className = 'seo-score low';
    el.textContent = `SEO ${score}점 낮음`;
  }
}

async function handleGenerate() {
  const keyword = document.getElementById('keywordInput').value.trim();
  const category = document.getElementById('categorySelect').value;
  if (!keyword) { showToast('키워드를 입력해주세요.', 'error'); return; }

  setStatus('AI가 글을 작성 중입니다...', true);
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;

  const res = await api.generatePost({ keyword, style: selectedStyle, category });

  document.getElementById('generateBtn').disabled = false;

  if (!res.success) {
    setStatus('');
    showToast(res.error || '글 생성 실패', 'error');
    return;
  }

  document.getElementById('titleInput').value = res.data.title;

  // Separate hashtags from content
  const rawContent = res.data.content || '';
  const hashtagMatch = rawContent.match(/\nHASHTAGS:\s*(.+)$/);
  if (hashtagMatch) {
    currentHashtags = hashtagMatch[1].trim();
    document.getElementById('contentInput').value = rawContent.replace(/\nHASHTAGS:.+$/, '').trim();
  } else {
    currentHashtags = res.data.hashtags || '';
    document.getElementById('contentInput').value = rawContent;
  }

  if (currentHashtags) {
    const hashtagArea = document.getElementById('hashtagArea');
    hashtagArea.textContent = currentHashtags;
    hashtagArea.classList.add('visible');
  }

  document.getElementById('humanizeBtn').disabled = false;
  document.getElementById('publishBtn').disabled = false;

  updateSeoScore();
  setStatus('✅ 글 생성 완료. 검토 후 다듬기 또는 발행하세요.');
  showToast('글 생성 완료!', 'success');
}

async function handleHumanize() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title || !content) { showToast('먼저 글을 생성해주세요.', 'error'); return; }

  setStatus('AI 감지 우회 처리 중...', true);
  document.getElementById('humanizeBtn').disabled = true;

  const keyword = document.getElementById('keywordInput').value.trim();
  const res = await api.humanizePost({ title, content, keyword });

  if (!res.success) {
    setStatus('');
    showToast(res.error || '처리 실패', 'error');
    document.getElementById('humanizeBtn').disabled = false;
    return;
  }

  const rawContent = res.data.content || '';
  const hashtagMatch = rawContent.match(/\nHASHTAGS:\s*(.+)$/);
  if (hashtagMatch) {
    currentHashtags = hashtagMatch[1].trim();
    document.getElementById('contentInput').value = rawContent.replace(/\nHASHTAGS:.+$/, '').trim();
    const hashtagArea = document.getElementById('hashtagArea');
    hashtagArea.textContent = currentHashtags;
    hashtagArea.classList.add('visible');
  } else {
    document.getElementById('contentInput').value = rawContent;
  }

  document.getElementById('titleInput').value = res.data.title;
  updateSeoScore();
  setStatus('✅ 자연스럽게 다듬기 완료.');
  showToast('다듬기 완료!', 'success');
  document.getElementById('humanizeBtn').disabled = false;
}

async function handlePublish() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  const category = document.getElementById('categorySelect').value;
  if (!title || !content) { showToast('제목과 본문을 먼저 생성해주세요.', 'error'); return; }

  setStatus('네이버 에디터를 여는 중...', true);
  document.getElementById('publishBtn').disabled = true;

  const saveRes = await api.savePost({
    keyword: document.getElementById('keywordInput').value.trim(),
    style: selectedStyle,
    category,
    title,
    content,
    processedContent: content,
    hashtags: currentHashtags,
    status: 'published',
  });
  currentPostId = saveRes.id;

  const res = await api.publishNow({
    postId: currentPostId,
    title,
    content,
    hashtags: currentHashtags,
    category,
  });

  if (!res.success) {
    setStatus('');
    showToast(res.error || '발행 실패', 'error');
    document.getElementById('publishBtn').disabled = false;
    return;
  }

  setStatus('✅ 네이버 에디터가 열렸습니다. 이미지를 추가하고 발행 버튼을 눌러주세요.');
  showToast('에디터 열기 완료!', 'success');
  document.getElementById('publishBtn').disabled = false;

  // Show URL input for post-publish tracking
  document.getElementById('urlInputRow').style.display = 'flex';
}

async function handleSaveUrl() {
  const url = document.getElementById('naverUrlInput').value.trim();
  if (!url || !currentPostId) { showToast('URL과 게시물 ID가 필요합니다.', 'error'); return; }
  if (!url.startsWith('https://blog.naver.com/')) {
    showToast('올바른 네이버 블로그 URL을 입력해주세요.', 'error');
    return;
  }

  await api.updatePostUrl({ postId: currentPostId, naverUrl: url });
  showToast('URL이 저장됐습니다. 3일 후 성과를 자동으로 확인합니다.', 'success');
  document.getElementById('urlInputRow').style.display = 'none';
}

async function handleSaveDraft() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title && !content) { showToast('저장할 내용이 없습니다.', 'error'); return; }

  await api.savePost({
    keyword: document.getElementById('keywordInput').value.trim(),
    style: selectedStyle,
    category: document.getElementById('categorySelect').value,
    title: title || '제목 없음',
    content,
    hashtags: currentHashtags,
    status: 'draft',
  });

  showToast('초안이 저장되었습니다.', 'success');
}

function clearContent() {
  document.getElementById('keywordInput').value = '';
  document.getElementById('titleInput').value = '';
  document.getElementById('contentInput').value = '';
  document.getElementById('hashtagArea').textContent = '';
  document.getElementById('hashtagArea').classList.remove('visible');
  document.getElementById('seoScore').className = 'seo-score';
  document.getElementById('urlInputRow').style.display = 'none';
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;
  currentHashtags = '';
  currentPostId = null;
  setStatus('');
}

// Live SEO score update
document.getElementById('titleInput')?.addEventListener('input', updateSeoScore);
document.getElementById('contentInput')?.addEventListener('input', updateSeoScore);

// Pre-fill keyword from dashboard
const savedKeyword = sessionStorage.getItem('selectedKeyword');
if (savedKeyword) {
  document.getElementById('keywordInput').value = savedKeyword;
  sessionStorage.removeItem('selectedKeyword');
}
