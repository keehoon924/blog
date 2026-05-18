let currentPostId = null;
let currentHashtags = '';
let currentImagePath = null;

const PROMPT_PLACEHOLDERS = {
  daily:      '예: 오늘 퇴근 후 혼자 카페에서 보낸 1시간 경험으로 글 써줘. 30대 직장인 공감 가도록, 친근한 말투로.',
  recipe:     '예: 에어프라이어로 만드는 쉬운 닭가슴살 요리 레시피 써줘. 다이어트하는 사람 대상, 초보자도 따라할 수 있게.',
  restaurant: '예: 성수동 새로 생긴 브런치 카페 방문 후기 써줘. 데이트 장소로 추천하는 내용으로, 감성적으로.',
  economy:    '예: 2025년 청년 전세 대출 조건 변경 내용으로 글 써줘. 30대 사회초년생 입장에서 지금 당장 해야 할 것 위주로.',
  book:       '예: 미움받을 용기 독후감 써줘. 자존감 낮은 사람에게 추천하는 관점으로, 인상 깊은 구절 포함.',
  car:        '예: 현대 아이오닉5 2026 직접 시승한 솔직한 후기 써줘. 패밀리카로 고민 중인 분들 대상, 장단점 비교.',
  pet:        '예: 강아지 분리불안 해결한 실제 경험담 써줘. 반려견 처음 키우는 분들에게 도움 되는 내용으로.',
  sports:     '예: 손흥민 이번 시즌 활약 분석 글 써줘. 팬 시선에서 솔직하게, 전술적 관점도 포함.',
  other:      '예: 혼자 여행할 때 꼭 알아야 할 것들 써줘. 20~30대 여성 대상, 실용적인 팁 위주로.',
  comfort_morning: '예: 월요일 아침, 알람 끄고 침대에서 5분 더 누워있는 사람에게 건네는 짧은 위로. 출근길에 읽을 글. (비워두면 AI가 알아서 결정)',
  comfort_lunch:   '예: 오전 내내 눈치 보면서 버텼던 직장인의 점심 시간. 잠깐의 쉼표를 건네는 공감 에세이. (비워두면 AI가 알아서 결정)',
  comfort_evening: '예: 퇴근하고 현관문 닫는 순간 힘이 풀리는 사람에게 건네는 깊은 위로. 하루 마무리. (비워두면 AI가 알아서 결정)',
};

function onCategoryChange() {
  const category = document.getElementById('categorySelect').value;
  const promptInput = document.getElementById('promptInput');
  if (promptInput) promptInput.placeholder = PROMPT_PLACEHOLDERS[category] || PROMPT_PLACEHOLDERS.other;
}

function selectImgStyle(btn) {
  document.querySelectorAll('[data-imgstyle]').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
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
  const kw = keyword.split(/[\s(]/)[0].toLowerCase();
  const titleLower = title.toLowerCase();
  const contentLower = content.toLowerCase();

  if (titleLower.includes(kw)) score += 30;
  if (title.length >= 15 && title.length <= 25) score += 15;
  if (contentLower.slice(0, 100).includes(kw)) score += 20;
  const kwCount = (contentLower.match(new RegExp(kw, 'g')) || []).length;
  if (kwCount >= 3) score += 20; else if (kwCount >= 1) score += 10;
  const textLen = content.replace(/\[이미지:[^\]]*\]/g, '').length;
  if (textLen >= 2000) score += 15; else if (textLen >= 1200) score += 8;

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
  const userPrompt = document.getElementById('promptInput').value.trim();
  const category = document.getElementById('categorySelect').value;

  if (!keyword) {
    showToast('SEO 키워드를 입력해주세요. (예: 청년 전세 대출)', 'error');
    document.getElementById('keywordInput').focus();
    return;
  }

  const newsMsg = userPrompt ? ' (최신 뉴스 검색 중...)' : '';
  setStatus(`AI가 글을 작성 중입니다${newsMsg}`, true);
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;

  const res = await api.generatePost({ keyword, userPrompt, style: 'emotional', category });

  document.getElementById('generateBtn').disabled = false;

  if (!res.success) {
    setStatus('');
    showToast(res.error || '글 생성 실패', 'error');
    return;
  }

  document.getElementById('titleInput').value = res.data.title;

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
  document.getElementById('imgGenBtn').disabled = false;

  updateSeoScore();
  setStatus('✅ 글 생성 완료. 검토 후 다듬기 또는 발행하세요.');
  showToast('글 생성 완료!', 'success');
}

async function handleGenerateImage() {
  const keyword = document.getElementById('keywordInput').value.trim();
  const category = document.getElementById('categorySelect').value;
  if (!keyword) { showToast('SEO 키워드를 먼저 입력해주세요.', 'error'); return; }

  const imgStyleBtn = document.querySelector('[data-imgstyle].selected');
  const imgStyle = imgStyleBtn ? imgStyleBtn.dataset.imgstyle : 'blog';

  setStatus('AI 이미지 생성 중... (약 10~20초)', true);
  document.getElementById('imgGenBtn').disabled = true;

  const res = await api.generateImage({ subject: keyword, category, style: imgStyle });

  document.getElementById('imgGenBtn').disabled = false;

  if (!res.success) {
    setStatus('');
    showToast(res.error || '이미지 생성 실패', 'error');
    return;
  }

  currentImagePath = res.data.filepath;

  const preview = document.getElementById('imagePreview');
  document.getElementById('previewImg').src = res.data.dataUrl;
  document.getElementById('imgFilename').textContent = res.data.filename;
  preview.style.display = 'block';

  setStatus('✅ 이미지 생성 완료. 네이버 에디터에서 직접 업로드하세요.');
  showToast('이미지 생성 완료!', 'success');
}

async function handleHumanize() {
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  if (!title || !content) { showToast('먼저 글을 생성해주세요.', 'error'); return; }

  setStatus('AI 감지 우회 처리 중...', true);
  document.getElementById('humanizeBtn').disabled = true;

  const keyword = document.getElementById('keywordInput').value.trim();
  const res = await api.humanizePost({ title, content, subject: keyword });

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

  const keyword = document.getElementById('keywordInput').value.trim();
  const userPrompt = document.getElementById('promptInput').value.trim();

  const saveRes = await api.savePost({
    subject: keyword,
    perspective: userPrompt.slice(0, 100),
    style: 'emotional',
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
    subject: document.getElementById('keywordInput').value.trim(),
    perspective: document.getElementById('promptInput').value.trim().slice(0, 100),
    style: 'emotional',
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
  document.getElementById('promptInput').value = '';
  document.getElementById('titleInput').value = '';
  document.getElementById('contentInput').value = '';
  document.getElementById('hashtagArea').textContent = '';
  document.getElementById('hashtagArea').classList.remove('visible');
  document.getElementById('seoScore').className = 'seo-score';
  document.getElementById('urlInputRow').style.display = 'none';
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;
  document.getElementById('imgGenBtn').disabled = true;
  document.getElementById('imagePreview').style.display = 'none';
  document.getElementById('previewImg').src = '';
  currentHashtags = '';
  currentPostId = null;
  currentImagePath = null;
  setStatus('');
}

document.getElementById('titleInput')?.addEventListener('input', updateSeoScore);
document.getElementById('contentInput')?.addEventListener('input', updateSeoScore);
document.getElementById('keywordInput')?.addEventListener('input', updateSeoScore);

onCategoryChange();

const savedKeyword = sessionStorage.getItem('selectedKeyword');
if (savedKeyword) {
  document.getElementById('keywordInput').value = savedKeyword;
  sessionStorage.removeItem('selectedKeyword');
}
