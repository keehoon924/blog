/**
 * SE5 DOM Inspector v2
 * 실행: npm run inspect
 * 확인 항목: 정렬 드롭다운 옵션, 인용구 탈출, 구분선 커서, 에디터 프레임 구조
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
  console.log('  로그인 중... (2FA 있으면 직접 완료, 최대 2분 대기)');
  await page.waitForFunction(() => !window.location.hostname.includes('nid.naver.com'), { timeout: 120000 });
}

// ── 현재 포커스 경로 ──────────────────────────────────────────────────────
async function focusPath(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return 'null';
    const parts = [];
    let cur = el;
    for (let i = 0; i < 6 && cur && cur.tagName !== 'BODY'; i++) {
      parts.push(`${cur.tagName}[${(cur.getAttribute('class') || '').split(' ').filter(Boolean).slice(0, 3).join('.')}]`);
      cur = cur.parentElement;
    }
    return parts.join(' → ');
  });
}

// ── 인용구 안에 있는지 (iframe 포함) ────────────────────────────────────
async function isInsideQuote(page) {
  // 1) outer page
  const outer = await page.evaluate(() => {
    let el = document.activeElement;
    while (el) {
      const c = el.getAttribute('class') || '';
      if (c.includes('se-quotation') || c.includes('se-quote')) return true;
      el = el.parentElement;
    }
    return false;
  });
  if (outer) return true;

  // 2) iframe 내부 확인
  try {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      const inner = await frame.evaluate(() => {
        let el = document.activeElement;
        while (el) {
          const c = el.getAttribute('class') || '';
          if (c.includes('se-quotation') || c.includes('se-quote')) return true;
          el = el.parentElement;
        }
        return false;
      }).catch(() => false);
      if (inner) return true;
    }
  } catch { /* ignore */ }
  return false;
}

// ── 화면에 보이는 모든 버튼 덤프 ────────────────────────────────────────
async function dumpVisibleButtons(page, label) {
  const result = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]'))
      .filter(b => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(b => ({
        tag: b.tagName,
        cls: (b.getAttribute('class') || '').substring(0, 120),
        ariaLabel: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        dataType: b.getAttribute('data-type') || '',
        dataName: b.getAttribute('data-name') || '',
        dataValue: b.getAttribute('data-value') || '',
        text: b.textContent.trim().substring(0, 40),
        role: b.getAttribute('role') || '',
      }))
  );
  return { label, buttons: result };
}

// ── 특정 data-name 버튼 클릭 ──────────────────────────────────────────
async function clickByDataName(page, dataName, dataType) {
  let sel = `button[data-name="${dataName}"]`;
  if (dataType) sel += `[data-type="${dataType}"]`;
  try {
    const el = await page.$(sel);
    if (el) {
      await el.scrollIntoViewIfNeeded();
      await el.click();
      await sleep(500);
      return { success: true, selector: sel };
    }
  } catch (e) {
    return { success: false, error: e.message };
  }
  return { success: false, error: 'element not found: ' + sel };
}

// ── 에디터 프레임 구조 분석 ───────────────────────────────────────────
async function analyzeFrames(page) {
  const frames = page.frames();
  const result = [];
  for (const frame of frames) {
    try {
      const url = frame.url();
      const editables = await frame.evaluate(() =>
        Array.from(document.querySelectorAll('[contenteditable]')).map(el => ({
          tag: el.tagName,
          cls: (el.getAttribute('class') || '').substring(0, 80),
          ce: el.getAttribute('contenteditable'),
        }))
      ).catch(() => []);
      const seClassCount = await frame.evaluate(() => {
        const s = new Set();
        document.querySelectorAll('[class]').forEach(el =>
          (el.getAttribute('class') || '').split(/\s+/).forEach(c => { if (c.startsWith('se-')) s.add(c); })
        );
        return s.size;
      }).catch(() => 0);
      result.push({ url: url.substring(0, 100), editables, seClassCount });
    } catch { /* skip */ }
  }
  return result;
}

// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const naverID = process.env.NAVER_ID;
  const naverPW = process.env.NAVER_PW;
  if (!naverID || !naverPW) { console.error('❌ .env 파일에 NAVER_ID, NAVER_PW 필요'); process.exit(1); }

  const browser = await chromium.launch({
    headless: false, slowMo: 25,
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
  console.log('\n[OPEN] 에디터 열기...');
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);
  if (page.url().includes('nid.naver.com')) {
    await doLogin(page, naverID, naverPW);
    await context.storageState({ path: SESSION_FILE });
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  console.log('[WAIT] 에디터 로딩 대기 6초...');
  await sleep(6000);

  const dump = { timestamp: new Date().toISOString() };

  // ══════════════════════════════════════════════════════════════════════
  // STAGE A: 프레임 구조 분석
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] 프레임 구조 분석...');
  dump.A_frames = await analyzeFrames(page);
  dump.A_frames.forEach((f, i) => console.log(`  frame[${i}]: url=${f.url} | se-classes=${f.seClassCount} | editables=${f.editables.length}`));

  // ══════════════════════════════════════════════════════════════════════
  // STAGE B: 제목 입력 + 본문 이동
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] 제목 입력...');
  const titleSels = [
    '.se-documentTitle-inputArea', '.se-title-text',
    '[placeholder*="제목"]', '.se-documentTitle [contenteditable]',
  ];
  let titleClicked = false;
  for (const sel of titleSels) {
    const el = await page.$(sel);
    if (el) {
      await el.click(); await sleep(400);
      await page.keyboard.press('Control+a'); await sleep(100);
      await page.keyboard.type('인스펙터 v2 테스트'); await sleep(300);
      console.log(`  제목 완료: ${sel}`);
      dump.B_titleSelector = sel;
      titleClicked = true;
      break;
    }
  }
  if (!titleClicked) {
    // iframe 내부 탐색
    const frames = page.frames();
    for (const frame of frames) {
      for (const sel of titleSels) {
        try {
          const el = await frame.$(sel);
          if (el) {
            await el.click(); await sleep(400);
            await frame.keyboard.type('인스펙터 v2 테스트 (iframe)');
            dump.B_titleSelector = `iframe::${sel}`;
            titleClicked = true;
            break;
          }
        } catch { /* skip */ }
      }
      if (titleClicked) break;
    }
  }
  dump.B_titleFound = titleClicked;
  console.log(`  제목 셀렉터: ${dump.B_titleSelector || 'NOT FOUND'}`);

  // Enter → 본문으로 이동
  await page.keyboard.press('Enter'); await sleep(600);
  dump.B_focusAfterEnter = await focusPath(page);
  console.log(`  Enter 후 포커스: ${dump.B_focusAfterEnter}`);

  // ══════════════════════════════════════════════════════════════════════
  // STAGE C: 본문 텍스트 입력 후 정렬 드롭다운 테스트
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] 본문 입력 + 정렬 드롭다운 테스트...');
  await page.keyboard.type('정렬 테스트 문장입니다. 이 줄은 가운데 정렬이 되어야 합니다.');
  await sleep(400);

  // C-1: 정렬 드롭다운 버튼 클릭 전 상태
  dump.C1_beforeAlignClick = await dumpVisibleButtons(page, '정렬 드롭다운 클릭 전');
  const alignBtn = await page.$('[data-name="align-drop-down-with-justify"]');
  console.log(`  정렬 드롭다운 버튼 존재: ${!!alignBtn}`);

  if (alignBtn) {
    await alignBtn.scrollIntoViewIfNeeded();
    await alignBtn.click();
    await sleep(600);
    console.log('  정렬 드롭다운 클릭 완료');

    // C-2: 드롭다운 열린 후 모든 버튼 덤프
    dump.C2_afterAlignDropdown = await dumpVisibleButtons(page, '정렬 드롭다운 열린 후');

    // 드롭다운 안 버튼만 필터 (새로 나타난 것들)
    const dropdownButtons = await page.evaluate(() => {
      const container = document.querySelector('.se-property-toolbar-drop-down-container, [class*="drop-down-container"]');
      if (!container) return { found: false, html: '' };
      return {
        found: true,
        html: container.outerHTML.substring(0, 3000),
        buttons: Array.from(container.querySelectorAll('button, [role="button"], li, [role="option"]')).map(b => ({
          tag: b.tagName,
          cls: (b.getAttribute('class') || '').substring(0, 100),
          dataValue: b.getAttribute('data-value') || '',
          dataName: b.getAttribute('data-name') || '',
          dataType: b.getAttribute('data-type') || '',
          text: b.textContent.trim().substring(0, 30),
          ariaLabel: b.getAttribute('aria-label') || '',
        })),
      };
    });
    dump.C2_dropdownContent = dropdownButtons;
    console.log('  드롭다운 컨테이너 찾음:', dropdownButtons.found);
    if (dropdownButtons.found) {
      console.log('  드롭다운 버튼들:');
      dropdownButtons.buttons.forEach(b => console.log('   ', JSON.stringify(b)));
    } else {
      // 전체 페이지에서 새로 나타난 버튼들을 찾음
      console.log('  드롭다운 컨테이너 미발견. 전체 visible 버튼 중 정렬 관련:');
      const allAfter = dump.C2_afterAlignDropdown.buttons.filter(b =>
        [b.cls, b.dataValue, b.dataName, b.text, b.ariaLabel].join(' ').match(/왼쪽|가운데|오른쪽|left|center|right|justify|align/i)
      );
      console.log(JSON.stringify(allAfter, null, 2));
      dump.C2_alignRelatedButtons = allAfter;
    }

    // C-3: 가운데 정렬 클릭 시도
    const centerAttempts = [
      '[data-value="center"]',
      '[data-name="align-center"]',
      'button:has-text("가운데")',
      '[aria-label*="가운데"]',
      '[title*="가운데"]',
    ];
    let centerClicked = false;
    for (const sel of centerAttempts) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click(); await sleep(400);
          dump.C3_centerAlignSelector = sel;
          centerClicked = true;
          console.log(`  가운데 정렬 클릭: ${sel}`);
          break;
        }
      } catch { /* try next */ }
    }
    if (!centerClicked) {
      console.log('  ❌ 가운데 정렬 버튼 못 찾음. 드롭다운 HTML 확인 필요');
      dump.C3_centerAlignSelector = 'NOT FOUND';
      // ESC로 드롭다운 닫기
      await page.keyboard.press('Escape'); await sleep(300);
    }

    // C-4: 정렬 후 단락 클래스 확인
    dump.C4_paragraphClassAfterAlign = await page.evaluate(() => {
      const paras = Array.from(document.querySelectorAll('[class*="se-text-paragraph"]'));
      return paras.map(p => ({ cls: (p.getAttribute('class') || '').substring(0, 100) }));
    });
    console.log('  정렬 후 단락 클래스:', dump.C4_paragraphClassAfterAlign);
  } else {
    dump.C1_alignBtnNotFound = true;
    console.log('  ❌ 정렬 드롭다운 버튼 없음');
  }

  // ══════════════════════════════════════════════════════════════════════
  // STAGE D: 인용구 삽입 + 탈출 테스트
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] 인용구 삽입 & 탈출 테스트...');
  await page.keyboard.press('Enter'); await sleep(300);

  // D-1: 인용구 버튼 클릭 (정확한 셀렉터)
  const quoteResult = await clickByDataName(page, 'quotation', 'icon-select');
  dump.D1_quoteClick = quoteResult;
  console.log(`  인용구 버튼 클릭: ${quoteResult.success ? '✅ ' + quoteResult.selector : '❌ ' + quoteResult.error}`);
  await sleep(500);

  dump.D1_focusAfterClick = await focusPath(page);
  dump.D1_insideQuote = await isInsideQuote(page);
  console.log(`  클릭 후 포커스: ${dump.D1_focusAfterClick}`);
  console.log(`  인용구 안에 있음: ${dump.D1_insideQuote}`);

  // D-2: 인용구 텍스트 입력
  await page.keyboard.type('남에게 어떻게 보일까라는 두려움에서 벗어나 자신에게 솔직해지는 것이다.');
  await sleep(400);
  dump.D2_insideQuoteAfterType = await isInsideQuote(page);
  console.log(`  텍스트 입력 후 인용구 안: ${dump.D2_insideQuoteAfterType}`);

  // D-3: 인용구 안에서 Enter (같은 블록 내 줄바꿈인지 새 컴포넌트인지 확인)
  console.log('  Enter 키 테스트 (인용구 안에서)...');
  await page.keyboard.press('Enter'); await sleep(500);
  dump.D3_insideQuoteAfterEnter = await isInsideQuote(page);
  dump.D3_focusAfterEnter = await focusPath(page);
  console.log(`  Enter 후 인용구 안: ${dump.D3_insideQuoteAfterEnter} | 포커스: ${dump.D3_focusAfterEnter}`);

  // 출처 입력 (Enter 로 줄 분리 된 경우)
  await page.keyboard.type('— 미움받을 용기');
  await sleep(400);

  // D-4: 탈출 방법들 순서대로 테스트
  console.log('  탈출 시도 A: ArrowDown...');
  await page.keyboard.press('ArrowDown'); await sleep(500);
  dump.D4a_afterArrowDown = {
    insideQuote: await isInsideQuote(page),
    focus: await focusPath(page),
  };
  console.log(`    결과: 인용구 안=${dump.D4a_afterArrowDown.insideQuote} | ${dump.D4a_afterArrowDown.focus}`);

  if (dump.D4a_afterArrowDown.insideQuote) {
    console.log('  탈출 시도 B: ArrowDown + Enter...');
    await page.keyboard.press('ArrowDown'); await sleep(300);
    await page.keyboard.press('Enter'); await sleep(500);
    dump.D4b_afterArrowDownEnter = {
      insideQuote: await isInsideQuote(page),
      focus: await focusPath(page),
    };
    console.log(`    결과: 인용구 안=${dump.D4b_afterArrowDownEnter.insideQuote}`);

    if (dump.D4b_afterArrowDownEnter.insideQuote) {
      console.log('  탈출 시도 C: JS로 인용구 다음 빈 컴포넌트 클릭...');
      const escaped = await page.evaluate(() => {
        // se-components-wrap 안의 컴포넌트들
        const wrap = document.querySelector('.se-components-wrap, .se-canvas, .se-body, .se-content');
        if (!wrap) return { success: false, reason: 'wrap not found' };
        const components = Array.from(wrap.querySelectorAll('.se-component'));
        const quoteComp = components.find(c => (c.getAttribute('class') || '').includes('se-quotation'));
        if (!quoteComp) return { success: false, reason: 'quotation component not found' };
        const next = quoteComp.nextElementSibling;
        if (next) {
          const editable = next.querySelector('[contenteditable]');
          if (editable) { editable.click(); editable.focus(); return { success: true, reason: 'clicked next editable' }; }
          next.click();
          return { success: true, reason: 'clicked next component' };
        }
        // 마지막 컴포넌트면 se-canvas-bottom 클릭
        const bottom = document.querySelector('.se-canvas-bottom, .se-canvas-bottom-button');
        if (bottom) { bottom.click(); return { success: true, reason: 'clicked canvas bottom' }; }
        return { success: false, reason: 'no next component' };
      });
      dump.D4c_jsEscape = escaped;
      await sleep(400);
      dump.D4c_afterJs = { insideQuote: await isInsideQuote(page), focus: await focusPath(page) };
      console.log(`    JS 탈출: ${JSON.stringify(escaped)} | 인용구 안: ${dump.D4c_afterJs.insideQuote}`);
    }
  } else {
    console.log('  ✅ ArrowDown으로 탈출 성공!');
    dump.D4_exitMethod = 'ArrowDown';
  }

  // D-5: 탈출 후 새 텍스트 입력 가능한지 테스트
  await page.keyboard.type('인용구 다음 일반 텍스트');
  await sleep(400);
  dump.D5_textAfterQuote = { insideQuote: await isInsideQuote(page), focus: await focusPath(page) };
  console.log(`  인용구 후 텍스트 입력: 인용구 안=${dump.D5_textAfterQuote.insideQuote}`);

  // ══════════════════════════════════════════════════════════════════════
  // STAGE E: 구분선 삽입 + 커서 위치 확인
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] 구분선 삽입 테스트...');
  await page.keyboard.press('Enter'); await sleep(300);

  const divResult = await clickByDataName(page, 'horizontal-line', 'icon-select');
  dump.E1_dividerClick = divResult;
  console.log(`  구분선 클릭: ${divResult.success ? '✅' : '❌ ' + divResult.error}`);
  await sleep(500);

  dump.E1_focusAfterDivider = await focusPath(page);
  console.log(`  구분선 후 포커스: ${dump.E1_focusAfterDivider}`);

  // 구분선 후 텍스트 입력 바로 가능한지
  await page.keyboard.type('구분선 다음 텍스트');
  await sleep(400);
  dump.E2_textAfterDivider = await focusPath(page);
  console.log(`  구분선 후 텍스트 입력 포커스: ${dump.E2_textAfterDivider}`);

  // ══════════════════════════════════════════════════════════════════════
  // STAGE F: 굵게 + 글자색 동작 확인
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[F] 굵게 + 글자색 테스트...');
  await page.keyboard.press('Enter'); await sleep(200);
  await page.keyboard.type('굵게 테스트');
  await sleep(300);

  // 텍스트 선택 (shift+home)
  await page.keyboard.press('Shift+Home'); await sleep(200);

  // 굵게 클릭
  const boldResult = await clickByDataName(page, 'bold', 'toggle');
  dump.F1_boldClick = boldResult;
  console.log(`  굵게: ${boldResult.success ? '✅' : '❌'}`);
  await sleep(300);

  // 글자색 버튼 클릭 → 어떤 UI가 나오는지 확인
  const fontColorBtn = await page.$('button[data-name="font-color"]');
  if (fontColorBtn) {
    dump.F2_fontColorBtnFound = true;
    // 클릭 전 visible 버튼 수
    const beforeCount = (await dumpVisibleButtons(page, 'before font-color')).buttons.length;
    await fontColorBtn.click(); await sleep(600);
    dump.F2_afterFontColorClick = await dumpVisibleButtons(page, 'after font-color click');
    const afterCount = dump.F2_afterFontColorClick.buttons.length;
    console.log(`  글자색 클릭 후 새 버튼 수: +${afterCount - beforeCount}`);

    // 색상 선택지 파악
    const colorPicker = await page.evaluate(() => {
      const cp = document.querySelector('.se-property-color-picker-container, [class*="color-picker"]');
      if (!cp) return { found: false };
      return {
        found: true,
        html: cp.outerHTML.substring(0, 2000),
        buttons: Array.from(cp.querySelectorAll('button, [role="button"]')).map(b => ({
          cls: (b.getAttribute('class') || '').substring(0, 80),
          dataValue: b.getAttribute('data-value') || '',
          title: b.getAttribute('title') || '',
          style: b.getAttribute('style') || '',
        })).slice(0, 20),
      };
    });
    dump.F2_colorPicker = colorPicker;
    console.log(`  컬러피커 찾음: ${colorPicker.found}`);

    // ESC로 닫기
    await page.keyboard.press('Escape'); await sleep(300);
  } else {
    dump.F2_fontColorBtnFound = false;
    console.log('  ❌ 글자색 버튼 없음');
  }

  // ══════════════════════════════════════════════════════════════════════
  // STAGE G: 전체 에디터 구조 최종 확인
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[G] 에디터 구조 최종 확인...');
  dump.G_editorContainerCandidates = await page.evaluate(() => {
    const candidates = [
      '.se-canvas', '.se-body', '.se-content', '.se-wrap',
      '.se-components-wrap', '.se-container', '[class*="se-canvas"]',
    ];
    const result = {};
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      result[sel] = el ? {
        tag: el.tagName,
        cls: (el.getAttribute('class') || '').substring(0, 80),
        childCount: el.children.length,
        html: el.innerHTML.substring(0, 500),
      } : null;
    }
    return result;
  });

  // se-component 구조 확인 (현재 삽입된 컴포넌트들)
  dump.G_components = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.se-component')).map(c => ({
      cls: (c.getAttribute('class') || '').substring(0, 100),
      childClasses: Array.from(c.children).map(ch => (ch.getAttribute('class') || '').substring(0, 60)),
    }))
  );
  console.log(`  se-component 수: ${dump.G_components.length}`);
  dump.G_components.forEach((c, i) => console.log(`    [${i}] ${c.cls}`));

  // ── 결과 저장 ──────────────────────────────────────────────────────────
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dump, null, 2), 'utf8');
  console.log('\n══════════════════════════════════════════════');
  console.log(`✅ v2 분석 완료!  →  ${OUTPUT_FILE}`);
  console.log('이 파일을 Claude에게 붙여넣거나 공유해주세요.');
  console.log('══════════════════════════════════════════════\n');

  await sleep(5 * 60 * 1000);
  await browser.close();
}

main().catch(err => { console.error('❌ 오류:', err.message); process.exit(1); });
