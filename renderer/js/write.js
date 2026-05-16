let selectedStyle = 'emotional';
let currentPostId = null;

function selectStyle(btn) {
  document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedStyle = btn.dataset.style;
}

function setStatus(msg, loading = false) {
  const el = document.getElementById('statusMsg');
  el.innerHTML = loading
    ? `<span class="spinner"></span> ${msg}`
    : msg;
}

function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => { t.className = ''; }, 3000);
}

function setButtonsEnabled(generating) {
  document.getElementById('generateBtn').disabled = generating;
  document.getElementById('humanizeBtn').disabled = generating;
  document.getElementById('publishBtn').disabled = generating;
}

async function handleGenerate() {
  const keyword = document.getElementById('keywordInput').value.trim();
  if (!keyword) { showToast('키워드를 입력해주세요.', 'error'); return; }

  setStatus('AI가 글을 작성 중입니다...', true);
  setButtonsEnabled(true);

  const res = await api.generatePost({ keyword, style: selectedStyle });

  if (!res.success) {
    setStatus('');
    showToast(res.error || '글 생성 실패', 'error');
    setButtonsEnabled(false);
    return;
  }

  document.getElementById('titleInput').value = res.data.title;
  document.getElementById('contentInput').value = res.data.content;
  document.getElementById('humanizeBtn').disabled = false;
  document.getElementById('publishBtn').disabled = false;

  setStatus('✅ 글 생성 완료. 검토 후 다듬기 또는 발행하세요.');
  showToast('글 생성 완료!', 'success');
  document.getElementById('generateBtn').disabled = false;
}

async function handleHumanize() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title || !content) { showToast('먼저 글을 생성해주세요.', 'error'); return; }

  setStatus('AI 감지 우회 처리 중...', true);
  document.getElementById('humanizeBtn').disabled = true;

  const res = await api.humanizePost({ title, content });

  if (!res.success) {
    setStatus('');
    showToast(res.error || '처리 실패', 'error');
    document.getElementById('humanizeBtn').disabled = false;
    return;
  }

  document.getElementById('titleInput').value = res.data.title;
  document.getElementById('contentInput').value = res.data.content;

  setStatus('✅ 자연스럽게 다듬기 완료.');
  showToast('다듬기 완료!', 'success');
  document.getElementById('humanizeBtn').disabled = false;
}

async function handlePublish() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title || !content) { showToast('제목과 본문을 먼저 생성해주세요.', 'error'); return; }

  setStatus('네이버 에디터를 여는 중...', true);
  document.getElementById('publishBtn').disabled = true;

  // Save post first
  const saveRes = await api.savePost({
    keyword: document.getElementById('keywordInput').value.trim(),
    style: selectedStyle,
    title,
    content,
    processedContent: content,
    status: 'published',
  });
  currentPostId = saveRes.id;

  const res = await api.publishNow({ postId: currentPostId, title, content });

  if (!res.success) {
    setStatus('');
    showToast(res.error || '발행 실패', 'error');
    document.getElementById('publishBtn').disabled = false;
    return;
  }

  setStatus('✅ 네이버 에디터가 열렸습니다. 이미지를 추가하고 발행 버튼을 눌러주세요.');
  showToast('에디터 열기 완료!', 'success');
  document.getElementById('publishBtn').disabled = false;
}

async function handleSaveDraft() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title && !content) { showToast('저장할 내용이 없습니다.', 'error'); return; }

  await api.savePost({
    keyword: document.getElementById('keywordInput').value.trim(),
    style: selectedStyle,
    title: title || '제목 없음',
    content,
    status: 'draft',
  });

  showToast('초안이 저장되었습니다.', 'success');
}

function clearContent() {
  document.getElementById('keywordInput').value = '';
  document.getElementById('titleInput').value = '';
  document.getElementById('contentInput').value = '';
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;
  setStatus('');
}

// Pre-fill keyword from dashboard
const savedKeyword = sessionStorage.getItem('selectedKeyword');
if (savedKeyword) {
  document.getElementById('keywordInput').value = savedKeyword;
  sessionStorage.removeItem('selectedKeyword');
}
