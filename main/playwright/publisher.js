const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');

// Parse bold segments: [{text, bold}]
function parseSegments(text) {
  const segments = [];
  const regex = /\*\*([^*\n]+)\*\*/g;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index), bold: false });
    segments.push({ text: match[1], bold: true });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), bold: false });
  return segments;
}

// Remove image placeholders
function stripImagePlaceholders(content) {
  return content.replace(/\[이미지:[^\]]*\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// GPT 응답이 본문 끝에 HASHTAGS/TAGS 라벨을 한 번 더 흘려도 잘라낸다.
function stripContentArtifacts(text) {
  return text
    .replace(/\n*\**\s*HASHTAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*TAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*해시\s*태그\s*:?[\s\S]*$/i, '')
    .trim();
}

// 가독성: 문장 종료 부호 뒤에 줄바꿈을 강제(1문장 1줄), 2~3문장 후 빈 줄
function makeReadable(text) {
  // 1. 인용구/구분선 마커는 보호
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*\[(구분선|짧은구분선|인용구:|이미지:)/.test(line)) {
      out.push(line);
      continue;
    }
    // 마침표·물음표·느낌표·말줄임표 뒤에 공백이 오면 줄바꿈
    let processed = line.replace(/([.!?…。])\s+(?=\S)/g, '$1\n');
    // 1문장 1줄 결과에서 2문장마다 빈 줄 추가
    const sentences = processed.split('\n');
    const grouped = [];
    sentences.forEach((s, i) => {
      grouped.push(s);
      // 2문장마다 빈 줄 (마지막 문장 제외)
      if ((i + 1) % 2 === 0 && i < sentences.length - 1) grouped.push('');
    });
    out.push(grouped.join('\n'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// \n을 Enter 키로 변환해서 입력 (Playwright keyboard.type은 \n을 Enter로 안 바꿈)
async function slowType(page, text) {
  const parts = text.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.length > 0) {
      const chunks = part.match(/[\s\S]{1,80}/g) || [part];
      for (const chunk of chunks) {
        await page.keyboard.type(chunk, { delay: 18 });
        await page.waitForTimeout(60);
      }
    }
    // 마지막 조각이 아니면 Enter (줄바꿈)
    if (i < parts.length - 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(90);
    }
  }
}

async function typeWithFormatting(page, text) {
  const segments = parseSegments(text);
  let isBold = false;
  for (const seg of segments) {
    if (seg.bold !== isBold) {
      await page.keyboard.press('Control+b');
      isBold = seg.bold;
      await page.waitForTimeout(80);
    }
    await slowType(page, seg.text);
  }
  if (isBold) {
    await page.keyboard.press('Control+b');
    await page.waitForTimeout(80);
  }
}

// Click toolbar button by label text
async function clickToolbarButton(page, label) {
  const selectors = [
    `[title="${label}"]`,
    `[aria-label="${label}"]`,
    `button:has-text("${label}")`,
    `.se-toolbar button:has-text("${label}")`,
    `.se-toolbar-item:has-text("${label}")`,
    `button[data-type="${label}"]`,
  ];
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await el.click();
        await page.waitForTimeout(400);
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// Insert 인용구 (blockquote) via toolbar
// quoteRaw 형식: "인용문 | – 출처명" 또는 "인용문" (출처 없는 경우)
async function insertQuote(page, quoteRaw) {
  const pipeIdx = quoteRaw.indexOf(' | ');
  const quoteText = pipeIdx !== -1 ? quoteRaw.slice(0, pipeIdx).trim() : quoteRaw.trim();
  const attribution = pipeIdx !== -1 ? quoteRaw.slice(pipeIdx + 3).trim() : '';

  const clicked = await clickToolbarButton(page, '인용구');
  if (clicked) {
    await page.waitForTimeout(300);
    await slowType(page, quoteText);
    if (attribution) {
      // 같은 블록 안에서 Enter로 줄 분리 (Tab은 SE5에서 출처 필드 없음)
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      await slowType(page, attribution);
    }
    // 인용구 블록 탈출: Escape → ArrowDown → Enter
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(250);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  } else {
    // Fallback: 텍스트 형태
    const full = attribution ? `${quoteText}\n${attribution}` : quoteText;
    await page.keyboard.type(`❝ ${full} ❞`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
}

// 카테고리별 정렬 정책 — 사용자 결정 + 조사 결과 기반
// body: 본문 단락 정렬, accent: 소제목·인용구·구분선·마무리 인사 정렬
const ALIGN_POLICY = {
  daily:      { body: 'left',   accent: 'center' }, // 일상: 본문 좌측, 강조만 가운데
  recipe:     { body: 'left',   accent: 'center' }, // 요리: 좌측 + 박스/스텝 가운데
  restaurant: { body: 'left',   accent: 'center' }, // 맛집: 좌측 + 가게정보 가운데
  economy:    { body: 'left',   accent: 'left'   }, // 경제: 전부 좌측 (정보 신뢰감)
  book:       { body: 'center', accent: 'center' }, // 책: 감성형 → 전체 가운데
  car:        { body: 'left',   accent: 'left'   }, // 자동차: 전부 좌측 (스펙 가독성)
  pet:        { body: 'left',   accent: 'center' }, // 펫: 좌측 + 인용 박스 가운데
  sports:     { body: 'left',   accent: 'left'   }, // 스포츠: 전부 좌측 (데이터 정렬)
  other:      { body: 'left',   accent: 'center' },
};

// JavaScript로 본문 단락 DOM에 직접 style.textAlign 주입
// (SE5 툴바 버튼 셀렉터 12개 모두 실패해서 DOM 조작이 가장 확실함)
async function alignAllParagraphs(page, align) {
  await page.evaluate((alignType) => {
    const titleEl = document.querySelector('.se-documentTitle');
    const selectors = [
      '.se-text-paragraph',
      '.se-component-content p',
      '.se-main-container [contenteditable="true"] p',
      '.se-main-container [contenteditable="true"] div',
      '.se-quote .se-text',
      '.se-horizontalLine',
    ];
    const seen = new Set();
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        if (seen.has(el)) return;
        if (titleEl && titleEl.contains(el)) return;
        seen.add(el);
        el.style.textAlign = alignType;
        el.setAttribute('data-text-align', alignType);
        // 자식 텍스트 요소에도 적용
        el.querySelectorAll('span, p, div').forEach((c) => {
          c.style.textAlign = alignType;
        });
      });
    });
  }, align);
  await page.waitForTimeout(300);
}

// 가운데 정렬 — 툴바 버튼 우선, 실패 시 단축키
async function clickAlignCenter(page) {
  const directSelectors = [
    '[aria-label*="가운데 정렬"]',
    '[aria-label*="가운데정렬"]',
    '[title*="가운데 정렬"]',
    '[title*="가운데정렬"]',
    '[data-name="align-center"]',
    '[data-type="align-center"]',
    '[data-type="text-align-center"]',
    'button.se-align-center',
    '.se-toolbar-item-align-center',
    '.se-text-align-center',
    'button[class*="align_center"]',
    'button[class*="alignCenter"]',
  ];
  for (const sel of directSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.scrollIntoViewIfNeeded();
        await el.click();
        await page.waitForTimeout(300);
        return true;
      }
    } catch { /* try next */ }
  }
  // 정렬 드롭다운을 먼저 열어야 하는 경우
  const dropdownSelectors = [
    '[aria-label*="정렬"]',
    '[title*="정렬"]',
    'button[class*="align"]',
    '.se-align',
  ];
  for (const sel of dropdownSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await page.waitForTimeout(300);
        for (const inner of directSelectors) {
          const itm = await page.$(inner);
          if (itm) {
            await itm.click();
            await page.waitForTimeout(300);
            return true;
          }
        }
      }
    } catch { /* try next */ }
  }
  // 백업: 단축키 (SE5에서 가로채일 수 있음)
  await page.keyboard.press('Control+e');
  await page.waitForTimeout(200);
  return false;
}

// Insert 구분선 (divider) via toolbar — 항상 긴 구분선
async function insertDivider(page) {
  const clicked = await clickToolbarButton(page, '구분선');
  if (!clicked) {
    await page.keyboard.type('─────────────────────────');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(200);
}

// Parse and type content with [구분선] and [인용구: text | 출처] markers
async function typeContentWithMarkers(page, content) {
  // 1. HASHTAGS 라벨 잔재 제거 → 2. 이미지 마커 제거 → 3. 가독성 줄바꿈
  const stage1 = stripContentArtifacts(content);
  const stage2 = stripImagePlaceholders(stage1);
  const cleaned = makeReadable(stage2);
  const markerRegex = /\[구분선\]|\[짧은구분선\]|\[인용구:([^\]]+)\]/g;
  let lastIndex = 0;
  let match;

  while ((match = markerRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      await typeWithFormatting(page, cleaned.slice(lastIndex, match.index));
    }
    if (match[0] === '[구분선]' || match[0] === '[짧은구분선]') {
      await insertDivider(page);
    } else {
      await insertQuote(page, match[1].trim());
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < cleaned.length) {
    await typeWithFormatting(page, cleaned.slice(lastIndex));
  }
}

async function typeHashtags(page, hashtags) {
  if (!hashtags) return;
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type(hashtags, { delay: 15 });
}

async function typeRelatedPosts(page, relatedPosts) {
  if (!relatedPosts || relatedPosts.length === 0) return;
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await insertDivider(page);
  await page.keyboard.press('Control+b');
  await page.keyboard.type('▼ 함께 읽으면 좋은 글', { delay: 20 });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  for (const post of relatedPosts) {
    await page.keyboard.type(`• ${post.title}`, { delay: 20 });
    await page.keyboard.press('Enter');
  }
}

async function doLogin(page, id, pw) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 10000 });

  await page.click('#id');
  await page.waitForTimeout(300);
  for (const char of id) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }
  await page.click('#pw');
  await page.waitForTimeout(300);
  for (const char of pw) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }
  await page.waitForTimeout(500);
  await page.click('.btn_login');

  // Wait for 2FA / full login (up to 120s)
  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 120000 }
  );
}

async function focusContentArea(page) {
  // Strategy 1: Enter from title naturally moves SE5 focus to first body paragraph
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);

  const leftTitle = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return false;
    const titleEl = document.querySelector('.se-documentTitle');
    return !(titleEl && titleEl.contains(el));
  });
  if (leftTitle) return;

  // Strategy 2: click known content-area selectors
  const contentSelectors = [
    '.se-section-text [contenteditable]',
    '.se-text-paragraph [contenteditable]',
    '.se-text-paragraph',
    '.se-main-section [contenteditable]',
  ];
  for (const sel of contentSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await el.click({ force: true });
      await page.waitForTimeout(200);
      return;
    }
  }

  // Strategy 3: first contenteditable NOT inside title container
  await page.evaluate(() => {
    const titleEl = document.querySelector('.se-documentTitle');
    const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
    for (const el of editables) {
      if (titleEl && titleEl.contains(el)) continue;
      el.click();
      el.focus();
      return;
    }
  });
  await page.waitForTimeout(200);
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config, category = 'other' }) {
  const policy = ALIGN_POLICY[category] || ALIGN_POLICY.other;
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) contextOptions.storageState = SESSION_FILE;

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;

  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);

  if (page.url().includes('nid.naver.com')) {
    await doLogin(page, naverID, naverPW);
    await context.storageState({ path: SESSION_FILE });
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  await page.waitForTimeout(2500);

  // ── Step 1: Type title ──────────────────────────────────────────
  const titleSelectors = ['.se-documentTitle-inputArea', '.se-title-text', '[placeholder*="제목"]'];
  for (const sel of titleSelectors) {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      await el.click();
      await page.waitForTimeout(500);
      // Clear existing
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(200);
      for (const char of title) {
        await page.keyboard.type(char);
        await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
      }
      break;
    }
  }

  await page.waitForTimeout(800);

  // ── Step 2: Move to content area (Enter from title → SE5 body) ──
  await focusContentArea(page);
  await page.waitForTimeout(400);

  // ── Step 2-1: body 정렬이 center인 카테고리만 입력 전 활성화 ──
  if (policy.body === 'center') {
    await clickAlignCenter(page);
    await page.waitForTimeout(300);
  }

  // ── Step 3: Type content with markers (줄바꿈·HASHTAGS 정리 포함) ──
  await typeContentWithMarkers(page, content);

  // ── Step 3-1: 카테고리 정책에 따라 본문 단락 정렬 DOM 직접 주입 ──
  // (SE5 툴바 셀렉터가 안 잡혀서 JavaScript로 paragraph에 style.textAlign 강제 적용)
  await alignAllParagraphs(page, policy.body);
  await page.waitForTimeout(200);

  // 본문 끝 커서 복귀
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);

  // ── Step 4: Hashtags ───────────────────────────────────────────
  await typeHashtags(page, hashtags);

  // ── Step 5: Related posts ──────────────────────────────────────
  await typeRelatedPosts(page, relatedPosts);

  // Browser stays open — user adds images and clicks publish
}

module.exports = { publishToNaver };
