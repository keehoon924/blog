const { chromium } = require('playwright');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const SESSION_FILE = path.join(app.getPath('userData'), 'naver-session.json');

// Bold 마커 파싱: [{text, bold}]
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

function stripImagePlaceholders(content) {
  return content.replace(/\[이미지:[^\]]*\]/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripContentArtifacts(text) {
  return text
    .replace(/\n*\**\s*HASHTAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*TAGS\s*:?[\s\S]*$/i, '')
    .replace(/\n*\**\s*해시\s*태그\s*:?[\s\S]*$/i, '')
    .trim();
}

// 문장 종료 부호 뒤에 줄바꿈 강제 (1문장 1줄)
function makeReadable(text) {
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^\s*\[(구분선|짧은구분선|인용구:|이미지:)/.test(line)) {
      out.push(line);
      continue;
    }
    let processed = line.replace(/([.!?…。])\s+(?=\S)/g, '$1\n');
    const sentences = processed.split('\n');
    const grouped = [];
    sentences.forEach((s, i) => {
      grouped.push(s);
      if ((i + 1) % 2 === 0 && i < sentences.length - 1) grouped.push('');
    });
    out.push(grouped.join('\n'));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// \n을 Enter 키로 변환해서 입력 (page.keyboard.type는 \n을 Enter로 처리 안 함)
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

// SE5 툴바 버튼 클릭 — data-name 속성 기반 (dom-dump.json으로 확인된 실제 구조)
async function clickToolbarBtn(page, dataName, dataType = null) {
  let selector = `button[data-name="${dataName}"]`;
  if (dataType) selector += `[data-type="${dataType}"]`;
  const el = await page.$(selector);
  if (el) {
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await page.waitForTimeout(400);
    return true;
  }
  return false;
}

// 가운데 정렬: 드롭다운 열기 → center 선택
// 확인된 구조: data-name="align-drop-down-with-justify" + data-value="center"
async function clickAlignCenter(page) {
  await clickToolbarBtn(page, 'align-drop-down-with-justify', 'drop-down');
  await page.waitForTimeout(300);
  const btn = await page.$('button[data-name="align-drop-down-with-justify"][data-value="center"]');
  if (btn) {
    await btn.click();
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

// Insert 인용구 — 확인된 셀렉터 + ArrowDown 탈출
// quoteRaw 형식: "인용문 | – 출처명" 또는 "인용문"
async function insertQuote(page, quoteRaw) {
  const pipeIdx = quoteRaw.indexOf(' | ');
  const quoteText = pipeIdx !== -1 ? quoteRaw.slice(0, pipeIdx).trim() : quoteRaw.trim();
  const attribution = pipeIdx !== -1 ? quoteRaw.slice(pipeIdx + 3).trim() : '';

  const clicked = await clickToolbarBtn(page, 'quotation', 'icon-select');
  if (clicked) {
    await page.waitForTimeout(300);
    await slowType(page, quoteText);
    if (attribution) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      await slowType(page, attribution);
    }
    // 블록 탈출: ArrowDown (dom-dump D4_exitMethod = "ArrowDown"으로 확인)
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(400);
  } else {
    const full = attribution ? `${quoteText}\n${attribution}` : quoteText;
    await page.keyboard.type(`❝ ${full} ❞`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }
}

// 카테고리별 정렬 정책
const ALIGN_POLICY = {
  daily:      { body: 'left',   accent: 'center' },
  recipe:     { body: 'left',   accent: 'center' },
  restaurant: { body: 'left',   accent: 'center' },
  economy:    { body: 'left',   accent: 'left'   },
  book:       { body: 'center', accent: 'center' },
  car:        { body: 'left',   accent: 'left'   },
  pet:        { body: 'left',   accent: 'center' },
  sports:     { body: 'left',   accent: 'left'   },
  other:      { body: 'left',   accent: 'center' },
};

// Insert 구분선 — 확인된 셀렉터
async function insertDivider(page) {
  const clicked = await clickToolbarBtn(page, 'horizontal-line', 'icon-select');
  if (!clicked) {
    await page.keyboard.type('─────────────────────────');
    await page.keyboard.press('Enter');
  }
  await page.waitForTimeout(200);
}

// 본문 마커([구분선], [인용구:]) 파싱 후 타이핑
async function typeContentWithMarkers(page, content) {
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

  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 120000 }
  );
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config, category = 'other' }) {
  const policy = ALIGN_POLICY[category] || ALIGN_POLICY.other;
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  // channel: 'chrome' uses the user's installed Chrome — no separate browser download needed
  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
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

  // ── Step 1: 제목 입력 (.se-title-text 확인됨) ──
  const titleEl = await page.$('.se-title-text');
  if (titleEl) {
    await titleEl.scrollIntoViewIfNeeded();
    await titleEl.click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    for (const char of title) {
      await page.keyboard.type(char);
      await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
    }
  }

  await page.waitForTimeout(800);

  // ── Step 2: 본문 영역으로 이동 ──
  // Enter 키 → 포커스가 IFRAME(에디터 콘텐츠 영역)으로 이동 (B_focusAfterEnter로 확인됨)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // ── Step 2-1: center 정렬 카테고리(book)는 첫 단락 시작 전 적용 ──
  // 드롭다운 → center 선택 (C2_dropdownContent로 확인된 구조)
  if (policy.body === 'center') {
    await clickAlignCenter(page);
    await page.waitForTimeout(300);
  }

  // ── Step 3: 본문 입력 ──
  await typeContentWithMarkers(page, content);

  // ── Step 4: 커서를 끝으로 ──
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);

  // ── Step 5: 해시태그 ──
  await typeHashtags(page, hashtags);

  // ── Step 6: 관련 글 ──
  await typeRelatedPosts(page, relatedPosts);

  // 브라우저 열린 상태 유지 — 사용자가 이미지 추가 후 직접 발행
}

module.exports = { publishToNaver };
