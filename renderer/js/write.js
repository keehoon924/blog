let selectedStyle = 'emotional';
let currentPostId = null;
let currentHashtags = '';

// 카테고리별 소재 입력 힌트
const SUBJECT_HINTS = {
  daily:      '예: 퇴근 후 카페에서 멍 때린 1시간',
  recipe:     '예: 쉬운 양파장아찌, 10분 계란볶음밥',
  restaurant: '예: 성수동 베이크플랜트, 이태원 라멘집',
  economy:    '예: 한국은행 기준금리 인상, 삼성전자 주가',
  book:       '예: 미움받을 용기 (기시미 이치로)',
  car:        '예: 현대 아이오닉5 2026 롱레인지',
  pet:        '예: 강아지 분리불안, 고양이 밥 안 먹는 이유',
  sports:     '예: 토트넘 vs 첼시, 손흥민 이번 시즌',
  other:      '예: 혼자 여행하는 법, 스마트폰 배터리 오래 쓰기',
};

const SUBJECT_PLACEHOLDERS = {
  daily:      '오늘의 에피소드나 경험을 한 줄로...',
  recipe:     '요리명을 입력하세요...',
  restaurant: '지역 + 가게명...',
  economy:    '정책·지표·종목명...',
  book:       '책 제목 (저자)...',
  car:        '차종 + 연식/등급...',
  pet:        '동물 종류 + 주제...',
  sports:     '팀·선수·경기명...',
  other:      '주제를 자유롭게 입력하세요...',
};

const PERSPECTIVE_HINTS = {
  daily:      '예: 혼자만의 시간이 필요한 이유 (비우면 AI가 결정)',
  recipe:     '예: 초보용, 다이어트 버전 (비우면 AI가 결정)',
  restaurant: '예: 데이트, 혼밥, 시그니처 메뉴 중심 (비우면 AI가 결정)',
  economy:    '예: 주담대 있는 분들께, 지금 해야 할 것 (비우면 AI가 결정)',
  book:       '예: 자존감 낮은 분께, 인상 깊은 구절 중심 (비우면 AI가 결정)',
  car:        '예: 패밀리카 비교, 구입 전 체크리스트 (비우면 AI가 결정)',
  pet:        '예: 직접 겪은 경험담, 수의사 추천 방법 (비우면 AI가 결정)',
  sports:     '예: 전술 분석, 이번 시즌 총평 (비우면 AI가 결정)',
  other:      '원하는 방향이 있으면 입력 (비우면 AI가 알아서)',
};

function onCategoryChange() {
  const category = document.getElementById('categorySelect').value;
  const subjectInput = document.getElementById('subjectInput');
  const perspectiveInput = document.getElementById('perspectiveInput');

  subjectInput.placeholder = SUBJECT_PLACEHOLDERS[category] || SUBJECT_PLACEHOLDERS.other;
  document.getElementById('subjectHint').textContent = SUBJECT_HINTS[category] || '';
  perspectiveInput.placeholder = PERSPECTIVE_HINTS[category] || PERSPECTIVE_HINTS.other;
  document.getElementById('perspectiveHint').textContent = '';
}

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

function calcSeoScore(subject, title, content) {
  if (!subject || !title || !content) return 0;
  let score = 0;
  // 소재의 핵심 단어(첫 단어 또는 전체)로 SEO 체크
  const kw = subject.split(/[\s(]/)[0].toLowerCase();
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
  const subject = document.getElementById('subjectInput').value.trim();
  const title = document.getElementById('titleInput').value.trim();
  const content = document.getElementById('contentInput').value.trim();
  const score = calcSeoScore(subject, title, content);

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
  const subject = document.getElementById('subjectInput').value.trim();
  const perspective = document.getElementById('perspectiveInput').value.trim();
  const category = document.getElementById('categorySelect').value;

  if (!subject) {
    showToast('소재를 입력해주세요. (예: 책 제목, 가게명, 요리명 등)', 'error');
    document.getElementById('subjectInput').focus();
    return;
  }

  setStatus('AI가 글을 작성 중입니다...', true);
  document.getElementById('generateBtn').disabled = true;
  document.getElementById('humanizeBtn').disabled = true;
  document.getElementById('publishBtn').disabled = true;

  const res = await api.generatePost({ subject, perspective, style: selectedStyle, category });

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

  const subject = document.getElementById('subjectInput').value.trim();
  const res = await api.humanizePost({ title, content, subject });

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

  const subject = document.getElementById('subjectInput').value.trim();
  const perspective = document.getElementById('perspectiveInput').value.trim();

  const saveRes = await api.savePost({
    subject,
    perspective,
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
    subject: document.getElementById('subjectInput').value.trim(),
    perspective: document.getElementById('perspectiveInput').value.trim(),
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
  document.getElementById('subjectInput').value = '';
  document.getElementById('perspectiveInput').value = '';
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
document.getElementById('subjectInput')?.addEventListener('input', updateSeoScore);

// 초기 placeholder 세팅
onCategoryChange();

// 대시보드에서 넘어온 키워드 → 소재 칸에 채우기
const savedKeyword = sessionStorage.getItem('selectedKeyword');
if (savedKeyword) {
  document.getElementById('subjectInput').value = savedKeyword;
  sessionStorage.removeItem('selectedKeyword');
}
