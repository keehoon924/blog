/**
 * SE5 DOM Inspector
 * 네이버 스마트에디터 ONE의 실제 DOM 구조를 분석해서 dom-dump.json에 저장합니다.
 * 실행: npm run inspect
 */
require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');
const OUTPUT_FILE  = path.join(process.cwd(), 'dom-dump.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function doLogin(page, id, pw) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 15000 });
  await page.click('#id'); await sleep(400);
  for (const c of id) { await page.keyboard.type(c); await sleep(30 + Math.random() * 60); }
  await page.click('#pw'); await sleep(400);
  for (const c of pw) { await page.keyboard.type(c); await sleep(30 + Math.random() * 60); }
  await sleep(600);
  await page.click('.btn_login');
  console.log('  로그인 중... (2FA가 있으면 직접 완료해주세요, 최대 2분 대기)');
  await page.waitForFunction(() => !window.location.hostname.includes('nid.naver.com'), { timeout: 120000 });
}

// ── 헬퍼: 현재 포커스가 인용구 안에 있는지 확인 ──────────────────────────
async function isInsideQuote(page) {
  return page.evaluate(() => {
    let el = document.activeElement;
    while (el) {
      const cls = el.className || '';
      if (cls.includes('se-quotation') || cls.includes('se-quote')) return true;
      el = el.parentElement;
    }
    return false;
  });
}

// ── 헬퍼: 현재 포커스 정보 스냅샷 ─────────────────────────────────────────
async function focusSnapshot(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const path = [];
    let cur = el;
    for (let i = 0; i < 8 && cur && cur !== document.body; i++) {
      path.push({ tag: cur.tagName, class: (cur.className || '').substring(0, 80) });
      cur = cur.parentElement;
    }
    return { path, contenteditable: el.getAttribute('contenteditable') };
  });
}

// ── 헬퍼: 특정 키워드로 버튼 후보 수집 ───────────────────────────────────
async function findButtons(page, keywords) {
  return page.evaluate((kws) => {
    return Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"]'))
      .map(b => ({
        tag: b.tagName,
        cls: (b.className || '').substring(0, 150),
        ariaLabel: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        dataType: b.getAttribute('data-type') || '',
        dataName: b.getAttribute('data-name') || '',
        id: b.id || '',
        text: b.textContent.trim().substring(0, 40),
      }))
      .filter(b => {
        const hay = [b.ariaLabel, b.title, b.text, b.cls, b.dataType, b.dataName].join(' ').toLowerCase();
        return kws.some(k => hay.includes(k.toLowerCase()));
      });
  }, keywords);
}

// ── 헬퍼: 툴바 전체 버튼 덤프 ────────────────────────────────────────────
async function dumpAllToolbarButtons(page) {
  return page.evaluate(() => {
    const toolbarRoots = [
      '.se-toolbar',
      '.se-toolbar-group',
      '[class*="toolbar"]',
    ];
    const seen = new Set();
    const results = [];
    for (const sel of toolbarRoots) {
      document.querySelectorAll(`${sel} button, ${sel} [role="button"]`).forEach(b => {
        if (seen.has(b)) return;
        seen.add(b);
        results.push({
          cls: (b.className || '').substring(0, 150),
          ariaLabel: b.getAttribute('aria-label') || '',
          title: b.getAttribute('title') || '',
          dataType: b.getAttribute('data-type') || '',
          dataName: b.getAttribute('data-name') || '',
          id: b.id || '',
          text: b.textContent.trim().substring(0, 40),
        });
      });
    }
    // 툴바 못 찾으면 전체 버튼 덤프
    if (results.length === 0) {
      document.querySelectorAll('button').forEach(b => {
        results.push({
          cls: (b.className || '').substring(0, 150),
          ariaLabel: b.getAttribute('aria-label') || '',
          title: b.getAttribute('title') || '',
          dataType: b.getAttribute('data-type') || '',
          dataName: b.getAttribute('data-name') || '',
          id: b.id || '',
          text: b.textContent.trim().substring(0, 40),
        });
      });
    }
    return results;
  });
}

// ── 헬퍼: 전체 se- 클래스 목록 ───────────────────────────────────────────
async function dumpSeClasses(page) {
  return page.evaluate(() => {
    const set = new Set();
    document.querySelectorAll('[class]').forEach(el => {
      (el.className || '').split(/\s+/).forEach(c => {
        if (c.startsWith('se-')) set.add(c);
      });
    });
    return Array.from(set).sort();
  });
}

// ── 헬퍼: 에디터 컨테이너 HTML 스냅샷 ────────────────────────────────────
async function editorSnapshot(page) {
  return page.evaluate(() => {
    const sel = ['.se-main-container', '.se-main-section', '.se-editor', '[class*="se-main"]'];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el) return { selector: s, html: el.innerHTML.substring(0, 4000) };
    }
    return { selector: 'NOT FOUND', html: '' };
  });
}

// ── 버튼 클릭 시도 (여러 방법) ─────────────────────────────────────────
async function tryClickButton(page, candidates) {
  for (const c of candidates) {
    const attempts = [];
    if (c.ariaLabel) attempts.push(`[aria-label="${c.ariaLabel}"]`);
    if (c.title)     attempts.push(`[title="${c.title}"]`);
    if (c.id)        attempts.push(`#${c.id}`);
    if (c.dataType)  attempts.push(`[data-type="${c.dataType}"]`);
    if (c.dataName)  attempts.push(`[data-name="${c.dataName}"]`);

    for (const sel of attempts) {
      try {
        const el = await page.$(sel);
        if (el) {
          const box = await el.boundingBox();
          if (box) {
            await el.scrollIntoViewIfNeeded();
            await el.click();
            await sleep(600);
            return { clicked: true, selector: sel, candidate: c };
          }
        }
      } catch { /* try next */ }
    }
  }
  return { clicked: false };
}

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const naverID = process.env.NAVER_ID;
  const naverPW = process.env.NAVER_PW;
  if (!naverID || !naverPW) {
    console.error('❌ .env 파일에 NAVER_ID, NAVER_PW를 설정해주세요.');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 25,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page    = await context.newPage();
  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;

  // ── 에디터 열기 ────────────────────────────────────────────────────────
  console.log('\n[1/9] 에디터 페이지 열기...');
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);

  if (page.url().includes('nid.naver.com')) {
    console.log('[로그인 필요]');
    await doLogin(page, naverID, naverPW);
    await context.storageState({ path: SESSION_FILE });
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }

  console.log('[에디터 로딩 대기 6초...]');
  await sleep(6000);

  const dump = { timestamp: new Date().toISOString(), naverID };

  // ── Stage 1: 초기 상태 ─────────────────────────────────────────────────
  console.log('[2/9] Stage 1: 초기 툴바 버튼 전체 덤프...');
  dump.s1_allToolbarButtons = await dumpAllToolbarButtons(page);
  dump.s1_seClasses         = await dumpSeClasses(page);
  dump.s1_editorSnapshot    = await editorSnapshot(page);
  console.log(`  툴바 버튼 수: ${dump.s1_allToolbarButtons.length}`);
  console.log(`  se- 클래스 수: ${dump.s1_seClasses.length}`);

  // ── Stage 2: 제목 입력 ─────────────────────────────────────────────────
  console.log('[3/9] Stage 2: 제목 입력...');
  const titleSels = ['.se-documentTitle-inputArea', '.se-title-text', '[placeholder*="제목"]'];
  for (const sel of titleSels) {
    const el = await page.$(sel);
    if (el) {
      await el.click(); await sleep(400);
      await page.keyboard.press('Control+a'); await sleep(100);
      await page.keyboard.type('DOM 인스펙터 테스트'); await sleep(300);
      console.log(`  제목 입력 완료 (${sel})`);
      break;
    }
  }

  // Enter → 본문으로 이동
  await page.keyboard.press('Enter');
  await sleep(600);
  dump.s2_focusAfterEnter = await focusSnapshot(page);

  // ── Stage 3: 본문 상태에서 툴바 재덤프 ────────────────────────────────
  console.log('[4/9] Stage 3: 본문 포커스 후 툴바 재덤프...');
  dump.s3_toolbarAfterFocus = await dumpAllToolbarButtons(page);
  dump.s3_seClassesAfterFocus = await dumpSeClasses(page);
  // 툴바 HTML 원본
  dump.s3_toolbarHTML = await page.evaluate(() => {
    const t = document.querySelector('.se-toolbar') || document.querySelector('[class*="toolbar"]');
    return t ? t.outerHTML.substring(0, 8000) : 'NOT FOUND';
  });

  // ── Stage 4: 인용구 버튼 찾기 ─────────────────────────────────────────
  console.log('[5/9] Stage 4: 인용구 버튼 탐색...');
  const quoteCandidates = await findButtons(page, ['인용', 'quote', 'blockquote', 'quotation']);
  dump.s4_quoteCandidates = quoteCandidates;
  console.log(`  인용구 버튼 후보: ${quoteCandidates.length}개`);
  quoteCandidates.forEach(c => console.log('   ', JSON.stringify(c)));

  // ── Stage 5: 인용구 버튼 클릭 + 탈출 실험 ────────────────────────────
  console.log('[6/9] Stage 5: 인용구 클릭 & 탈출 실험...');
  const quoteClickResult = await tryClickButton(page, quoteCandidates);
  dump.s5_quoteClickResult = quoteClickResult;

  if (quoteClickResult.clicked) {
    console.log(`  ✅ 클릭 성공: ${quoteClickResult.selector}`);
    dump.s5_focusAfterQuoteClick = await focusSnapshot(page);
    dump.s5_editorAfterQuoteClick = await editorSnapshot(page);
    dump.s5_insideQuote = await isInsideQuote(page);

    // 텍스트 입력
    await page.keyboard.type('테스트 인용문입니다.');
    await sleep(400);
    dump.s5_insideQuoteAfterType = await isInsideQuote(page);

    // 탈출 실험 A: ArrowDown
    console.log('  탈출 A: ArrowDown...');
    await page.keyboard.press('ArrowDown'); await sleep(400);
    const afterArrowDown = await isInsideQuote(page);
    dump.s5_exitA_arrowDown = { stillInQuote: afterArrowDown };
    console.log(`    여전히 인용구 안: ${afterArrowDown}`);

    // 탈출 실험 B: Escape
    console.log('  탈출 B: Escape...');
    await page.keyboard.press('Escape'); await sleep(400);
    const afterEscape = await isInsideQuote(page);
    dump.s5_exitB_escape = { stillInQuote: afterEscape };
    console.log(`    여전히 인용구 안: ${afterEscape}`);

    // 탈출 실험 C: Tab
    console.log('  탈출 C: Tab...');
    await page.keyboard.press('Tab'); await sleep(400);
    const afterTab = await isInsideQuote(page);
    dump.s5_exitC_tab = { stillInQuote: afterTab, focus: await focusSnapshot(page) };
    console.log(`    여전히 인용구 안: ${afterTab}`);

    // 탈출 실험 D: JS로 다음 컴포넌트 클릭
    console.log('  탈출 D: JS nextSibling...');
    const jsMoved = await page.evaluate(() => {
      const quote = document.querySelector('.se-quotation');
      if (!quote) return { success: false, reason: 'se-quotation not found' };
      const comp = quote.closest('.se-component');
      if (!comp) return { success: false, reason: '.se-component not found' };
      const next = comp.nextElementSibling;
      if (!next) {
        // 다음 컴포넌트 없으면 에디터 끝 클릭
        const container = document.querySelector('.se-main-container, .se-main-section');
        if (container) {
          container.click();
          return { success: true, reason: 'container click' };
        }
        return { success: false, reason: 'no next sibling, no container' };
      }
      const editable = next.querySelector('[contenteditable]');
      if (editable) { editable.focus(); editable.click(); return { success: true, reason: 'next editable' }; }
      next.click();
      return { success: true, reason: 'next component click' };
    });
    await sleep(400);
    const afterJS = await isInsideQuote(page);
    dump.s5_exitD_js = { ...jsMoved, stillInQuote: afterJS };
    console.log(`    JS 이동 결과:`, jsMoved, '  인용구 안:', afterJS);

    // 최종 포커스
    dump.s5_focusFinal = await focusSnapshot(page);
    dump.s5_editorFinal = await editorSnapshot(page);
  } else {
    console.log('  ❌ 인용구 버튼을 찾지 못함. 전체 버튼 목록 저장...');
    dump.s5_allButtonsFallback = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
        cls: (b.className || '').substring(0, 120),
        ariaLabel: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        text: b.textContent.trim().substring(0, 30),
      }))
    );
  }

  // ── Stage 6: 구분선 버튼 ──────────────────────────────────────────────
  console.log('[7/9] Stage 6: 구분선 버튼 탐색...');
  // 본문 클릭으로 포커스 복귀
  const bodyEl = await page.$('.se-text-paragraph, .se-section-text [contenteditable]');
  if (bodyEl) { await bodyEl.click(); await sleep(300); }

  const divCandidates = await findButtons(page, ['구분선', 'horizon', 'divider', 'hr', '가로선', 'horizontal', 'line']);
  dump.s6_dividerCandidates = divCandidates;
  console.log(`  구분선 버튼 후보: ${divCandidates.length}개`);
  divCandidates.forEach(c => console.log('   ', JSON.stringify(c)));

  // 클릭 테스트
  if (divCandidates.length > 0) {
    const divClick = await tryClickButton(page, divCandidates);
    dump.s6_dividerClickResult = divClick;
    if (divClick.clicked) {
      await sleep(500);
      dump.s6_editorAfterDivider = await editorSnapshot(page);
      dump.s6_focusAfterDivider  = await focusSnapshot(page);
    }
  }

  // ── Stage 7: 정렬 버튼 ────────────────────────────────────────────────
  console.log('[8/9] Stage 7: 정렬 버튼 탐색...');
  const alignCandidates = await findButtons(page, ['정렬', 'align', '왼쪽', '가운데', '오른쪽', 'left', 'center', 'right']);
  dump.s7_alignCandidates = alignCandidates;
  console.log(`  정렬 버튼 후보: ${alignCandidates.length}개`);
  alignCandidates.forEach(c => console.log('   ', JSON.stringify(c)));

  // ── Stage 8: 페이지 전체 링크·셀렉터 총정리 ───────────────────────────
  console.log('[9/9] Stage 8: 최종 전체 se- 클래스 & contenteditable 구조...');
  dump.s8_finalSeClasses = await dumpSeClasses(page);
  dump.s8_allEditables   = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
      tag: el.tagName,
      cls: (el.className || '').substring(0, 100),
      ariaLabel: el.getAttribute('aria-label') || '',
      placeholder: el.getAttribute('placeholder') || '',
      parentCls: (el.parentElement?.className || '').substring(0, 100),
    }))
  );

  // ── 결과 저장 ──────────────────────────────────────────────────────────
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dump, null, 2), 'utf8');
  console.log('\n══════════════════════════════════════════════');
  console.log(`✅ 분석 완료!  →  ${OUTPUT_FILE}`);
  console.log('이 파일을 Claude에게 붙여넣거나 공유해주세요.');
  console.log('브라우저를 닫으시려면 아무 키나 누르세요...');
  console.log('══════════════════════════════════════════════\n');

  // 5분 대기 후 종료
  await sleep(5 * 60 * 1000);
  await browser.close();
}

main().catch(err => {
  console.error('❌ 오류 발생:', err.message);
  process.exit(1);
});
