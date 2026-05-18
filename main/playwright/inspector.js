/**
 * SE5 DOM Inspector v4 — Range API 기반 정확한 검증
 *
 * v3의 한계: Shift+ArrowLeft로 selection 안 잡힘 → 색상/서식 적용 검증 실패
 * v4 해결: TreeWalker로 본문 텍스트 노드 찾아서 Range로 직접 선택
 *          드롭다운: 클릭 직전/직후 DOM diff로 새 컨테이너만 추출
 *          색상 적용 후: 본문 element의 computedStyle.color 직접 읽어 검증
 *
 * 실행: npm run inspect
 * 결과: dom-dump.json
 *
 * 안전:
 *   - 실제 발행 절대 안 함. 발행 다이얼로그 진입 → 전체 덤프 → X로 닫음.
 *   - 각 STAGE try-catch 격리.
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(process.cwd(), 'naver-session.json');
const OUTPUT_FILE  = path.join(process.cwd(), 'dom-dump.json');

const dump = { timestamp: new Date().toISOString(), version: 'v4' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function safeKey(page, key, wait = 200) { try { await page.keyboard.press(key); await sleep(wait); } catch (_) {} }
async function safeEscapeAll(page) { for (let i = 0; i < 3; i++) await safeKey(page, 'Escape', 150); }

async function stage(name, key, fn) {
  console.log(`\n[${key}] ${name}`);
  try {
    const t0 = Date.now();
    await fn();
    console.log(`  ✓ ${key} 완료 (${Date.now() - t0}ms)`);
  } catch (err) {
    console.log(`  ✗ ${key} 실패: ${err.message}`);
    dump[`${key}_error`] = err.message;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 본문 영역 찾기 + 명시적 포커스
// ────────────────────────────────────────────────────────────────────────────
async function getBodyInfo(page) {
  return page.evaluate(() => {
    const candidates = [
      '.se-component.se-text [contenteditable]',
      '.se-component-content [contenteditable]',
      '.se-content [contenteditable]',
      '.se-canvas [contenteditable]',
      'div.se-canvas',
    ];
    const found = [];
    for (const sel of candidates) {
      document.querySelectorAll(sel).forEach(el => {
        const r = el.getBoundingClientRect();
        found.push({
          sel,
          tag: el.tagName,
          cls: (el.getAttribute('class') || '').substring(0, 100),
          contenteditable: el.getAttribute('contenteditable'),
          visible: r.width > 0 && r.height > 0,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        });
      });
    }
    return found;
  }).catch(() => []);
}

// 본문 컴포넌트 중 하나를 클릭해서 포커스 확보
async function focusBody(page) {
  const components = await page.$$('.se-component.se-text');
  for (const c of components) {
    const visible = await c.isVisible().catch(() => false);
    if (visible) {
      await c.click(); await sleep(300);
      return true;
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Range API로 본문에서 텍스트 찾아 선택 (v4 핵심)
// ────────────────────────────────────────────────────────────────────────────
async function selectTextInBody(page, searchText) {
  return page.evaluate((needle) => {
    // 본문 영역 후보들에서 모두 탐색
    const containers = document.querySelectorAll('.se-component.se-text, .se-component-content, .se-content, .se-canvas');
    for (const container of containers) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node;
      while (node = walker.nextNode()) {
        const idx = node.textContent.indexOf(needle);
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + needle.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          return {
            ok: true,
            parentTag: node.parentElement.tagName,
            parentCls: (node.parentElement.getAttribute('class') || '').substring(0, 100),
            parentHtml: node.parentElement.outerHTML.substring(0, 500),
            containerCls: (container.getAttribute('class') || '').substring(0, 100),
            selectedText: sel.toString(),
          };
        }
      }
    }
    return { error: 'text "' + needle + '" not found in body' };
  }, searchText).catch(e => ({ error: e.message }));
}

// 선택된 텍스트의 부모 element를 찾아 style + html 반환 (적용 결과 확인용)
async function inspectSelectedElement(page, searchText) {
  return page.evaluate((needle) => {
    const containers = document.querySelectorAll('.se-component.se-text, .se-component-content, .se-content');
    for (const container of containers) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node;
      while (node = walker.nextNode()) {
        if (node.textContent.includes(needle)) {
          const parent = node.parentElement;
          const styles = window.getComputedStyle(parent);
          return {
            tag: parent.tagName,
            cls: (parent.getAttribute('class') || '').substring(0, 150),
            style: parent.getAttribute('style') || '',
            color: styles.color,
            backgroundColor: styles.backgroundColor,
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            fontStyle: styles.fontStyle,
            fontFamily: styles.fontFamily,
            textDecoration: styles.textDecoration,
            html: parent.outerHTML.substring(0, 800),
          };
        }
      }
    }
    return { error: 'text not found' };
  }, searchText).catch(e => ({ error: e.message }));
}

// ────────────────────────────────────────────────────────────────────────────
// 드롭다운 정확히 캡처 — 클릭 직전/직후 DOM 비교
// ────────────────────────────────────────────────────────────────────────────
async function snapshotDropdowns(page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('[class*="drop-down-container"], [class*="dropdown"], [class*="popup"]'))
      .filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map(el => ({
        cls: (el.getAttribute('class') || '').substring(0, 100),
        dataName: el.getAttribute('data-name') || '',
        id: el.id || '',
      }));
  }).catch(() => []);
}

async function clickAndCaptureDropdown(page, btnSelector) {
  await safeEscapeAll(page); // 혹시 열린 드롭다운 정리
  await sleep(300);

  const before = await snapshotDropdowns(page);
  const beforeKeys = new Set(before.map(b => b.cls + '|' + b.dataName));

  const el = await page.$(btnSelector);
  if (!el) return { error: 'button not found: ' + btnSelector };
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return { error: 'button not visible' };

  await el.scrollIntoViewIfNeeded();
  await el.click(); await sleep(600);

  // 직후 드롭다운 중 새로 나타난 것만
  const newDropdowns = await page.evaluate((beforeArr) => {
    const beforeSet = new Set(beforeArr.map(b => b.cls + '|' + b.dataName));
    const all = Array.from(document.querySelectorAll('[class*="drop-down-container"], [class*="dropdown"], [class*="popup"], [class*="property-toolbar"]'));
    const news = [];
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const key = (el.getAttribute('class') || '').substring(0, 100) + '|' + (el.getAttribute('data-name') || '');
      if (beforeSet.has(key)) continue;
      news.push({
        cls: (el.getAttribute('class') || '').substring(0, 120),
        dataName: el.getAttribute('data-name') || '',
        html: el.outerHTML.substring(0, 4000),
        items: Array.from(el.querySelectorAll('button, [role="option"], li')).map(b => ({
          tag: b.tagName,
          cls: (b.getAttribute('class') || '').substring(0, 100),
          dataValue: b.getAttribute('data-value') || '',
          dataName: b.getAttribute('data-name') || '',
          title: b.getAttribute('title') || '',
          text: b.textContent.trim().substring(0, 40),
          style: b.getAttribute('style') || '',
        })),
      });
    }
    return news;
  }, before).catch(e => ({ error: e.message }));

  return { success: true, before: before.length, newDropdowns };
}

// ────────────────────────────────────────────────────────────────────────────
// 색상 적용 전체 시퀀스 (v4 핵심)
// ────────────────────────────────────────────────────────────────────────────
async function applyColorSequence(page, searchText, hexColor) {
  const result = { searchText, hexColor };

  // 1) 텍스트 선택
  result.selectResult = await selectTextInBody(page, searchText);
  if (!result.selectResult.ok) return result;

  // 2) 선택 직후 element 상태
  result.beforeApply = await inspectSelectedElement(page, searchText);

  // 3) font-color 버튼 클릭
  const fcBtn = await page.$('button[data-name="font-color"]');
  if (!fcBtn) { result.error = 'font-color button not found'; return result; }
  await fcBtn.click(); await sleep(500);

  // 4) 색상 팔레트 클릭
  const colorClicked = await page.evaluate((hex) => {
    const btn = document.querySelector(`button.se-color-palette[title="${hex}"]`);
    if (!btn) return { error: 'color not found: ' + hex };
    btn.click();
    return { clicked: true };
  }, hexColor).catch(e => ({ error: e.message }));
  result.colorClick = colorClicked;
  await sleep(500);

  // 5) 적용 후 element 상태 — 색이 진짜 적용됐나
  result.afterApply = await inspectSelectedElement(page, searchText);

  // 6) 닫혀있어야 할 컬러 피커 ESC로 정리
  await safeEscapeAll(page);
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// 로그인
// ────────────────────────────────────────────────────────────────────────────
async function doLogin(page, id, pw) {
  await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 15000 });
  await page.click('#id'); await sleep(400);
  for (const c of id) { await page.keyboard.type(c); await sleep(30 + Math.random() * 60); }
  await page.click('#pw'); await sleep(400);
  for (const c of pw) { await page.keyboard.type(c); await sleep(30 + Math.random() * 60); }
  await sleep(600);
  await page.click('.btn_login');
  console.log('  로그인 중... (2FA/캡차 있으면 직접 완료, 최대 2분 대기)');
  await page.waitForFunction(() => !window.location.hostname.includes('nid.naver.com'), { timeout: 120000 });
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const naverID = process.env.NAVER_ID;
  const naverPW = process.env.NAVER_PW;
  if (!naverID || !naverPW) {
    console.error('❌ .env 파일에 NAVER_ID, NAVER_PW 필요'); process.exit(1);
  }

  const browser = await chromium.launch({
    headless: false, slowMo: 25, channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const ctxOpts = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };
  if (fs.existsSync(SESSION_FILE)) ctxOpts.storageState = SESSION_FILE;

  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const writeUrl = `https://blog.naver.com/PostWriteForm.naver?blogId=${naverID}`;

  console.log('\n[OPEN] 에디터 열기...');
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(1500);
  if (page.url().includes('nid.naver.com')) {
    await doLogin(page, naverID, naverPW);
    await context.storageState({ path: SESSION_FILE });
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  console.log('[WAIT] 에디터 로딩 8초...');
  await sleep(8000);

  // 임시 저장 글 다이얼로그 닫기 (있으면 '취소')
  await page.evaluate(() => {
    document.querySelectorAll('.se-popup-button-cancel, button').forEach(b => {
      if (b.textContent.trim() === '취소' && b.closest('.se-popup-container')) b.click();
    });
  }).catch(() => {});
  await sleep(1500);

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE A: 본문 영역 정확히 찾기 (v4 핵심 — Selection 문제 진단)
  // ═══════════════════════════════════════════════════════════════════════
  await stage('본문 영역 후보 정확히 매핑', 'A', async () => {
    dump.A_bodyInfo = await getBodyInfo(page);
    console.log(`  본문 element 후보 ${dump.A_bodyInfo.length}개`);
    dump.A_bodyInfo.forEach((b, i) => console.log(`    [${i}] ${b.sel} → ${b.tag} visible=${b.visible}`));
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE B: 제목 + 본문 진입 + 본문에 시드 텍스트 입력
  // ═══════════════════════════════════════════════════════════════════════
  await stage('제목 입력 + 본문에 시드 텍스트 입력', 'B', async () => {
    const titleEl = await page.$('.se-title-text');
    if (titleEl) {
      await titleEl.click(); await sleep(400);
      await page.keyboard.press('Control+a'); await sleep(100);
      await page.keyboard.type('v4 인스펙터 테스트', { delay: 40 });
      dump.B_titleOk = true;
    }
    await safeKey(page, 'Enter', 600);

    // 본문에 검증용 텍스트 5개 입력 (각각 unique한 마커)
    const seeds = ['보볼드테스트', '이이탤릭테스트', '밑밑줄테스트', '취취소선테스트', '색가나다라마'];
    for (const s of seeds) {
      await page.keyboard.type(s, { delay: 35 });
      await page.keyboard.press('Enter');
      await sleep(250);
    }
    await sleep(500);
    dump.B_seedsInput = seeds;

    // 본문에 실제로 들어갔는지 확인 — Range API로 첫 시드 찾기
    const verify = await selectTextInBody(page, seeds[0]);
    dump.B_verifySeed = verify;
    console.log(`  시드 입력 검증: ${verify.ok ? '✓' : '✗ ' + verify.error}`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 1: 툴바 전체 버튼 매핑 (이미 v3에서 확인됨, 간단히 재확인)
  // ═══════════════════════════════════════════════════════════════════════
  await stage('툴바 버튼 매핑 재확인', '1', async () => {
    dump.S1_allButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button[data-name]')).map(b => {
        const r = b.getBoundingClientRect();
        return {
          dataName: b.getAttribute('data-name') || '',
          dataType: b.getAttribute('data-type') || '',
          dataValue: b.getAttribute('data-value') || '',
          ariaLabel: b.getAttribute('aria-label') || '',
          visible: r.width > 0 && r.height > 0,
        };
      })
    ).catch(() => []);
    console.log(`  툴바 버튼 ${dump.S1_allButtons.length}개`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 2: 텍스트 서식 — Range API로 정확히 선택 → 적용 → 결과 검증
  // ═══════════════════════════════════════════════════════════════════════
  await stage('텍스트 서식 (Range API 선택 → 적용 → 검증)', '2', async () => {
    const tests = [
      { text: '보볼드테스트',     btn: 'bold',          key: 'S2_bold',          expect: 'fontWeight' },
      { text: '이이탤릭테스트',   btn: 'italic',        key: 'S2_italic',        expect: 'fontStyle' },
      { text: '밑밑줄테스트',     btn: 'underline',     key: 'S2_underline',     expect: 'textDecoration' },
      { text: '취취소선테스트',   btn: 'strikethrough', key: 'S2_strikethrough', expect: 'textDecoration' },
    ];
    for (const t of tests) {
      const sel = await selectTextInBody(page, t.text);
      if (!sel.ok) { dump[t.key] = { error: 'select failed: ' + sel.error }; continue; }
      const before = await inspectSelectedElement(page, t.text);
      const clickRes = await page.evaluate((dn) => {
        const b = document.querySelector(`button[data-name="${dn}"][data-type="toggle"]`);
        if (!b) return { error: 'btn not found' };
        b.click(); return { clicked: true };
      }, t.btn).catch(e => ({ error: e.message }));
      await sleep(400);
      const after = await inspectSelectedElement(page, t.text);
      dump[t.key] = { selectInfo: sel, before, click: clickRes, after };
      console.log(`  ${t.btn}: ${after.error ? '✗' : '✓'} before.${t.expect}=${before[t.expect]} after.${t.expect}=${after[t.expect]}`);
      await safeEscapeAll(page);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 3: 글자색 — Range API로 정확히 선택 → font-color → 색 클릭 → 검증
  // ═══════════════════════════════════════════════════════════════════════
  await stage('글자색 전체 시퀀스 검증', '3', async () => {
    // 다양한 색으로 테스트
    const colorTests = [
      { hex: '#ff0010', name: '빨강' },
      { hex: '#0078cb', name: '파랑' },
      { hex: '#3fcc9c', name: '청록' },
    ];
    // 색 적용 검증용 텍스트들 — 한글 입력
    await focusBody(page);
    await safeKey(page, 'End', 100);
    await safeKey(page, 'Enter', 200);
    for (const ct of colorTests) {
      await page.keyboard.type(`색${ct.name}샘플`, { delay: 35 });
      await page.keyboard.press('Enter');
      await sleep(200);
    }
    await sleep(500);

    dump.S3_colorTests = [];
    for (const ct of colorTests) {
      const seqResult = await applyColorSequence(page, `색${ct.name}샘플`, ct.hex);
      dump.S3_colorTests.push(seqResult);
      const applied = seqResult.afterApply && seqResult.afterApply.color && seqResult.afterApply.color !== seqResult.beforeApply?.color;
      console.log(`  ${ct.name} (${ct.hex}): ${applied ? '✓ 적용됨' : '✗ 미적용'} → ${seqResult.afterApply?.color || '?'}`);
    }

    // 컬러 피커 전체 색 덤프
    const fcBtn = await page.$('button[data-name="font-color"]');
    if (fcBtn) {
      await fcBtn.click(); await sleep(500);
      dump.S3_allColors = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button.se-color-palette')).map(b => ({
          title: b.getAttribute('title') || '',
          style: b.getAttribute('style') || '',
          cls: (b.getAttribute('class') || '').substring(0, 80),
        }))
      ).catch(() => []);
      console.log(`  전체 색상 ${dump.S3_allColors.length}개`);
      await safeEscapeAll(page);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 3b: 배경색 (font-color2 또는 background-color)
  // ═══════════════════════════════════════════════════════════════════════
  await stage('배경색 (형광펜) 전체 시퀀스', '3b', async () => {
    await focusBody(page);
    await safeKey(page, 'End', 100);
    await safeKey(page, 'Enter', 200);
    await page.keyboard.type('배배경테스트', { delay: 35 });
    await sleep(400);

    const sel = await selectTextInBody(page, '배배경테스트');
    dump.S3b_selectInfo = sel;
    if (!sel.ok) return;

    const bgBtn = await page.$('button[data-name="background-color"]');
    if (!bgBtn) { dump.S3b_error = 'background-color btn not found'; return; }
    await bgBtn.click(); await sleep(500);

    dump.S3b_allBgColors = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button.se-color-palette')).map(b => ({
        title: b.getAttribute('title') || '',
        style: b.getAttribute('style') || '',
      }))
    ).catch(() => []);
    console.log(`  배경색 ${dump.S3b_allBgColors.length}개`);

    // 노랑 형광펜 적용 시도
    const yellowClick = await page.evaluate(() => {
      const btn = document.querySelector('button.se-color-palette[title="#fff593"]');
      if (!btn) return { error: 'yellow not found' };
      btn.click();
      return { clicked: true };
    }).catch(e => ({ error: e.message }));
    dump.S3b_yellowClick = yellowClick;
    await sleep(500);
    dump.S3b_afterApply = await inspectSelectedElement(page, '배배경테스트');
    console.log(`  배경색 적용 결과 backgroundColor: ${dump.S3b_afterApply?.backgroundColor || '?'}`);
    await safeEscapeAll(page);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 4: 글자 크기 / 폰트 / 줄간격 — clickAndCaptureDropdown 사용
  // ═══════════════════════════════════════════════════════════════════════
  await stage('글자 크기 / 폰트 / 줄간격 드롭다운 — 정확한 캡처', '4', async () => {
    // 선택 먼저 (드롭다운이 selection 없으면 비활성)
    await selectTextInBody(page, '보볼드테스트');
    await sleep(200);

    dump.S4_fontSize    = await clickAndCaptureDropdown(page, 'button[data-name="font-size"]');
    await selectTextInBody(page, '보볼드테스트'); await sleep(200);
    dump.S4_fontFamily  = await clickAndCaptureDropdown(page, 'button[data-name="font-family"]');
    await selectTextInBody(page, '보볼드테스트'); await sleep(200);
    dump.S4_lineHeight  = await clickAndCaptureDropdown(page, 'button[data-name="line-height"]');

    const sizeItems = (dump.S4_fontSize.newDropdowns?.[0]?.items || []).length;
    const fontItems = (dump.S4_fontFamily.newDropdowns?.[0]?.items || []).length;
    const lineItems = (dump.S4_lineHeight.newDropdowns?.[0]?.items || []).length;
    console.log(`  크기 옵션 ${sizeItems}개 / 폰트 ${fontItems}개 / 줄간격 ${lineItems}개`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 5: 정렬 + 글머리 — clickAndCaptureDropdown으로
  // ═══════════════════════════════════════════════════════════════════════
  await stage('정렬 + 글머리 드롭다운 정확 캡처', '5', async () => {
    await selectTextInBody(page, '보볼드테스트'); await sleep(200);
    dump.S5_alignDropdown = await clickAndCaptureDropdown(page, 'button[data-name="align-drop-down-with-justify"]');
    await selectTextInBody(page, '보볼드테스트'); await sleep(200);
    dump.S5_listDropdown  = await clickAndCaptureDropdown(page, 'button[data-name="list"]');

    const alignCount = (dump.S5_alignDropdown.newDropdowns?.[0]?.items || []).length;
    const listCount  = (dump.S5_listDropdown.newDropdowns?.[0]?.items || []).length;
    console.log(`  정렬 옵션 ${alignCount}개 / 글머리 옵션 ${listCount}개`);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 6: 위첨자 / 아래첨자 (subscript/superscript) — 빠르게 확인
  // ═══════════════════════════════════════════════════════════════════════
  await stage('위첨자/아래첨자 검증', '6', async () => {
    const subResult = await page.evaluate(() => {
      const sub = document.querySelector('button[data-name="subscript"]');
      const sup = document.querySelector('button[data-name="superscript"]');
      return {
        subscript:   sub ? { exists: true, dataType: sub.getAttribute('data-type') } : null,
        superscript: sup ? { exists: true, dataType: sup.getAttribute('data-type') } : null,
      };
    }).catch(() => ({}));
    dump.S6_subSuper = subResult;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 7: 발행 다이얼로그 — 정확한 컨테이너 식별 + 카테고리 정확히
  // ═══════════════════════════════════════════════════════════════════════
  await stage('발행 다이얼로그 — 정확한 캡처', '7', async () => {
    const publishBtn = await page.$('button.publish_btn__m9KHH');
    if (!publishBtn) { dump.S7_error = '발행 버튼 못 찾음'; return; }
    await publishBtn.click();
    await sleep(2500);

    // 다이얼로그 컨테이너 찾기
    dump.S7_dialogContainer = await page.evaluate(() => {
      const candidates = [
        '[class*="layer_publish"]', '[class*="layer_post"]',
        '.se-popup-container', '[role="dialog"]',
        '[class*="publish_layer"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0) {
          return {
            selector: sel,
            cls: (el.getAttribute('class') || '').substring(0, 200),
            childCount: el.children.length,
          };
        }
      }
      // 발견 못하면 가장 큰 fixed/absolute 컨테이너
      const all = Array.from(document.querySelectorAll('div')).filter(el => {
        const s = window.getComputedStyle(el);
        return (s.position === 'fixed' || s.position === 'absolute') && el.offsetWidth > 500 && el.offsetHeight > 400;
      });
      if (all.length > 0) {
        const el = all[0];
        return {
          selector: 'auto-detect',
          cls: (el.getAttribute('class') || '').substring(0, 200),
          childCount: el.children.length,
        };
      }
      return null;
    }).catch(() => null);
    console.log(`  다이얼로그 컨테이너: ${dump.S7_dialogContainer?.selector || 'NOT FOUND'}`);

    // 다이얼로그 안의 모든 form 요소
    dump.S7_inputs = await page.evaluate(() => {
      // 다이얼로그 컨테이너 안에서만 검색
      const containers = [
        document.querySelector('[class*="layer_publish"]'),
        document.querySelector('[class*="publish_layer"]'),
        document.querySelector('.se-popup-container'),
      ].filter(Boolean);
      const root = containers[0] || document;
      return Array.from(root.querySelectorAll('input, select, textarea, button')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        cls: (el.getAttribute('class') || '').substring(0, 120),
        placeholder: el.getAttribute('placeholder') || '',
        text: el.textContent.trim().substring(0, 40),
        value: el.value || '',
        ariaLabel: el.getAttribute('aria-label') || '',
      }));
    }).catch(() => []);
    console.log(`  다이얼로그 입력/버튼: ${dump.S7_inputs.length}개`);

    // 공개 설정 라벨 (open_type 라디오의 라벨 텍스트)
    dump.S7_openTypeLabels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[name="open_type"]')).map(input => {
        // label은 input의 형제 또는 부모의 label 또는 for 속성
        let labelText = '';
        if (input.id) {
          const lbl = document.querySelector(`label[for="${input.id}"]`);
          if (lbl) labelText = lbl.textContent.trim();
        }
        if (!labelText) {
          const lbl = input.closest('label');
          if (lbl) labelText = lbl.textContent.trim();
        }
        if (!labelText) {
          const sib = input.nextElementSibling;
          if (sib) labelText = sib.textContent.trim();
        }
        return {
          id: input.id,
          value: input.value,
          label: labelText.substring(0, 30),
        };
      });
    }).catch(() => []);

    // 카테고리 — 다이얼로그 안에서 'category' 클래스 가진 버튼/select 찾기
    dump.S7_categoryUI = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('button, select, [role="combobox"], [role="listbox"]')).filter(el => {
        const cls = (el.getAttribute('class') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const id = (el.id || '').toLowerCase();
        const text = el.textContent.trim();
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return cls.includes('category') || aria.includes('카테고리') || aria.includes('category')
            || id.includes('category') || text.includes('카테고리');
      });
      return all.slice(0, 20).map(el => ({
        tag: el.tagName,
        cls: (el.getAttribute('class') || '').substring(0, 150),
        id: el.id || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        text: el.textContent.trim().substring(0, 60),
      }));
    }).catch(() => []);
    console.log(`  카테고리 UI 후보: ${dump.S7_categoryUI.length}개`);

    // 카테고리 드롭다운 클릭해서 옵션 덤프
    if (dump.S7_categoryUI.length > 0) {
      const opened = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('button')).filter(el => {
          const cls = (el.getAttribute('class') || '').toLowerCase();
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && cls.includes('category');
        });
        // 첫 카테고리 버튼 클릭
        if (all[0]) { all[0].click(); return { clicked: all[0].textContent.trim().substring(0, 30) }; }
        return { error: 'no category btn' };
      }).catch(e => ({ error: e.message }));
      dump.S7_categoryClick = opened;
      await sleep(700);

      dump.S7_categoryOptions = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li, [role="option"], button')).filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const t = el.textContent.trim();
          // 카테고리 옵션같이 보이는 것만 (짧은 텍스트, 다이얼로그 안)
          return t.length > 0 && t.length < 30;
        });
        return items.slice(0, 100).map(el => ({
          tag: el.tagName,
          cls: (el.getAttribute('class') || '').substring(0, 100),
          text: el.textContent.trim(),
          dataValue: el.getAttribute('data-value') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
        }));
      }).catch(() => []);
      console.log(`  카테고리 옵션 ${dump.S7_categoryOptions.length}개`);
      await safeEscapeAll(page);
    }

    // 최종 발행 버튼
    dump.S7_finalPublishBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => {
        const t = b.textContent.trim();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (t === '발행' || t === '발행하기');
      });
      return btns.map(b => ({
        cls: (b.getAttribute('class') || '').substring(0, 200),
        text: b.textContent.trim(),
        ariaLabel: b.getAttribute('aria-label') || '',
        dataClk: b.getAttribute('data-clk') || '',
      }));
    }).catch(() => []);
    console.log(`  최종 발행 버튼 후보 ${dump.S7_finalPublishBtn.length}개`);

    // X 버튼 / 닫기 버튼 찾기
    dump.S7_closeBtn = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('button')).filter(b => {
        const cls = (b.getAttribute('class') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (cls.includes('close') || aria.includes('close') || aria.includes('닫기'));
      });
      return candidates.slice(0, 5).map(b => ({
        cls: (b.getAttribute('class') || '').substring(0, 150),
        ariaLabel: b.getAttribute('aria-label') || '',
      }));
    }).catch(() => []);
    console.log(`  닫기 버튼 후보 ${dump.S7_closeBtn.length}개`);

    // 다이얼로그 닫기 — X 우선, 안 되면 ESC 여러 번
    const closeResult = await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const cls = (b.getAttribute('class') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (cls.includes('close') || aria.includes('close') || aria.includes('닫기'));
      });
      if (closeBtn) { closeBtn.click(); return 'close-button'; }
      return 'not-found';
    }).catch(() => 'error');
    dump.S7_closeMethod = closeResult;
    await sleep(500);
    await safeKey(page, 'Escape', 300);
    await safeKey(page, 'Escape', 300);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 8: 예약 발행 다이얼로그 — 날짜/시간/분 selector 완전 매핑
  // 안전: 절대 발행/예약 확정 안 함. 다이얼로그 열고 → 예약 모드 → 덤프 → X로 닫음.
  // ═══════════════════════════════════════════════════════════════════════
  await stage('예약 발행 다이얼로그 매핑 (안전 — 실제 예약 안 함)', '8', async () => {
    // 1) 다이얼로그 다시 열기 (STAGE 7에서 닫혔음)
    await safeEscapeAll(page);
    await sleep(800);
    const publishBtn = await page.$('button.publish_btn__m9KHH');
    if (!publishBtn) { dump.S8_error = '발행 버튼 못 찾음'; return; }
    await publishBtn.click();
    await sleep(2500);

    // 2) 다이얼로그 내 모든 라디오 + 라벨 텍스트 (현재/예약 토글)
    dump.S8_radios = await page.evaluate(() => {
      const containers = [
        document.querySelector('[class*="layer_publish"]'),
        document.querySelector('[class*="publish_layer"]'),
        document.querySelector('.se-popup-container'),
      ].filter(Boolean);
      const root = containers[0] || document;
      return Array.from(root.querySelectorAll('input[type="radio"]')).map(input => {
        let labelText = '';
        if (input.id) {
          const lbl = document.querySelector(`label[for="${input.id}"]`);
          if (lbl) labelText = lbl.textContent.trim();
        }
        if (!labelText && input.closest('label')) labelText = input.closest('label').textContent.trim();
        if (!labelText && input.nextElementSibling) labelText = input.nextElementSibling.textContent.trim();
        return {
          id: input.id, name: input.name, value: input.value,
          checked: input.checked, label: labelText.substring(0, 30),
        };
      });
    }).catch(() => []);
    console.log(`  다이얼로그 내 라디오 ${dump.S8_radios.length}개`);
    dump.S8_radios.forEach(r => console.log(`    [${r.name}=${r.value}] "${r.label}" ${r.checked ? '✓' : ''}`));

    // 3) "예약" 옵션 클릭 (3단계 fallback)
    const reserveClick = await page.evaluate(() => {
      const containers = [
        document.querySelector('[class*="layer_publish"]'),
        document.querySelector('[class*="publish_layer"]'),
        document.querySelector('.se-popup-container'),
      ].filter(Boolean);
      const root = containers[0] || document;

      // 방법 1: 라벨 텍스트 "예약" 정확 매칭
      const labels = Array.from(root.querySelectorAll('label'));
      for (const lbl of labels) {
        const text = lbl.textContent.trim();
        const r = lbl.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (text === '예약' || text === '예약 발행') {
          lbl.click();
          return { method: 'label-exact', text, htmlSnippet: lbl.outerHTML.substring(0, 300) };
        }
      }
      // 방법 2: 라디오 value
      const inputs = Array.from(root.querySelectorAll('input[type="radio"]'));
      for (const input of inputs) {
        const v = (input.value || '').toLowerCase();
        if (v === 'reserve' || v === 'schedule' || v === 'reservation' || v === 'later') {
          input.click();
          if (input.id) {
            const lbl = document.querySelector(`label[for="${input.id}"]`);
            if (lbl) lbl.click();
          }
          return { method: 'radio-value', value: input.value };
        }
      }
      // 방법 3: 라벨 부분 일치
      for (const lbl of labels) {
        const text = lbl.textContent.trim();
        if (text.includes('예약')) {
          lbl.click();
          return { method: 'label-partial', text };
        }
      }
      return { error: '예약 옵션 못 찾음' };
    }).catch(e => ({ error: e.message }));
    dump.S8_reserveClick = reserveClick;
    console.log(`  예약 클릭: ${JSON.stringify(reserveClick).substring(0, 200)}`);
    await sleep(1800);

    // 4) 예약 모드 진입 후 다이얼로그 전체 입력/버튼 덤프
    dump.S8_afterReserve = await page.evaluate(() => {
      const containers = [
        document.querySelector('[class*="layer_publish"]'),
        document.querySelector('[class*="publish_layer"]'),
        document.querySelector('.se-popup-container'),
      ].filter(Boolean);
      const root = containers[0] || document;
      return Array.from(root.querySelectorAll('input, select, button, [role="combobox"], [role="button"], [role="listbox"]')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map(el => ({
        tag: el.tagName,
        type: el.type || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        cls: (el.getAttribute('class') || '').substring(0, 150),
        placeholder: el.getAttribute('placeholder') || '',
        text: el.textContent.trim().substring(0, 60),
        value: el.value || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        dataValue: el.getAttribute('data-value') || '',
        role: el.getAttribute('role') || '',
      }));
    }).catch(() => []);
    console.log(`  예약 모드 입력/버튼 ${dump.S8_afterReserve.length}개`);

    // 5) 날짜 UI (input[type=date], placeholder/class에 date/calendar/년월일, 또는 YYYY-MM-DD 패턴)
    dump.S8_dateUI = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('input, button, [role="button"], [class*="date"], [class*="calendar"]')).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cls = (el.getAttribute('class') || '').toLowerCase();
        const ph = (el.getAttribute('placeholder') || '');
        const type = (el.getAttribute('type') || '');
        const aria = (el.getAttribute('aria-label') || '');
        const text = el.textContent.trim();
        return type === 'date' ||
               cls.includes('date') || cls.includes('calendar') ||
               /년|월|일|YYYY|MM|DD/i.test(ph) ||
               /날짜|date/i.test(aria) ||
               /\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(text);
      });
      return all.slice(0, 15).map(el => ({
        tag: el.tagName, type: el.type || '',
        cls: (el.getAttribute('class') || '').substring(0, 150),
        placeholder: el.getAttribute('placeholder') || '',
        value: el.value || '',
        text: el.textContent.trim().substring(0, 50),
        ariaLabel: el.getAttribute('aria-label') || '',
        html: el.outerHTML.substring(0, 500),
      }));
    }).catch(() => []);
    console.log(`  날짜 UI 후보 ${dump.S8_dateUI.length}개`);

    // 6) 시간/분 UI
    dump.S8_timeUI = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('select, input, button, [role="combobox"], [class*="hour"], [class*="minute"], [class*="time"]')).filter(el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cls = (el.getAttribute('class') || '').toLowerCase();
        const ph = (el.getAttribute('placeholder') || '');
        const aria = (el.getAttribute('aria-label') || '');
        return cls.includes('hour') || cls.includes('minute') || cls.includes('time') ||
               /시|분|HH|mm/.test(ph) ||
               /시|분|hour|minute|time/i.test(aria);
      });
      return all.slice(0, 30).map(el => ({
        tag: el.tagName, type: el.type || '',
        cls: (el.getAttribute('class') || '').substring(0, 150),
        placeholder: el.getAttribute('placeholder') || '',
        value: el.value || '',
        text: el.textContent.trim().substring(0, 50),
        ariaLabel: el.getAttribute('aria-label') || '',
        html: el.outerHTML.substring(0, 400),
      }));
    }).catch(() => []);
    console.log(`  시간/분 UI 후보 ${dump.S8_timeUI.length}개`);

    // 7) 다이얼로그 안 native select 옵션 전체 (시간/분이 select일 가능성)
    dump.S8_selects = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('select')).filter(s => {
        const r = s.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }).map(s => ({
        name: s.name || '', id: s.id || '',
        cls: (s.getAttribute('class') || '').substring(0, 100),
        ariaLabel: s.getAttribute('aria-label') || '',
        options: Array.from(s.options).slice(0, 70).map(o => ({
          value: o.value, text: o.textContent.trim(),
        })),
      }));
    }).catch(() => []);
    console.log(`  네이티브 select ${dump.S8_selects.length}개`);
    dump.S8_selects.forEach(s => console.log(`    select[name=${s.name || s.id}] options=${s.options.length}`));

    // 8) 날짜 input/버튼 클릭 → 캘린더 팝업 열기 시도
    const dateInputClick = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('input, button, [role="button"]')).filter(el => {
        const cls = (el.getAttribute('class') || '').toLowerCase();
        const type = el.getAttribute('type') || '';
        const aria = (el.getAttribute('aria-label') || '');
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return type === 'date' || cls.includes('date') || cls.includes('calendar') || /날짜/.test(aria);
      });
      if (candidates.length > 0) {
        candidates[0].click();
        return { clicked: true, cls: (candidates[0].getAttribute('class') || '').substring(0, 100) };
      }
      return { error: 'no date input' };
    }).catch(e => ({ error: e.message }));
    dump.S8_dateClick = dateInputClick;
    await sleep(1000);

    // 9) 캘린더 팝업 덤프 (날짜 셀 포함)
    dump.S8_calendar = await page.evaluate(() => {
      const calendars = Array.from(document.querySelectorAll('[class*="calendar"], [class*="datepicker"], [class*="date-picker"], [role="grid"]')).filter(el => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      return calendars.slice(0, 3).map(el => ({
        cls: (el.getAttribute('class') || '').substring(0, 200),
        role: el.getAttribute('role') || '',
        cells: Array.from(el.querySelectorAll('button, td, [role="gridcell"]')).slice(0, 50).map(c => ({
          tag: c.tagName,
          cls: (c.getAttribute('class') || '').substring(0, 80),
          text: c.textContent.trim().substring(0, 10),
          ariaLabel: c.getAttribute('aria-label') || '',
          dataValue: c.getAttribute('data-value') || '',
        })),
        html: el.outerHTML.substring(0, 2500),
      }));
    }).catch(() => []);
    console.log(`  캘린더 컨테이너 ${dump.S8_calendar.length}개`);

    await safeEscapeAll(page);
    await sleep(500);

    // 10) 최종 예약 발행 버튼 (텍스트 "예약 발행" 또는 "발행")
    dump.S8_finalReserveBtn = await page.evaluate(() => {
      const containers = [
        document.querySelector('[class*="layer_publish"]'),
        document.querySelector('[class*="publish_layer"]'),
        document.querySelector('.se-popup-container'),
      ].filter(Boolean);
      const root = containers[0] || document;
      const btns = Array.from(root.querySelectorAll('button')).filter(b => {
        const t = b.textContent.trim();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (t === '예약 발행' || t === '예약발행' || t === '발행' || t === '예약');
      });
      return btns.map(b => ({
        cls: (b.getAttribute('class') || '').substring(0, 200),
        text: b.textContent.trim(),
        ariaLabel: b.getAttribute('aria-label') || '',
        dataClk: b.getAttribute('data-clk') || '',
      }));
    }).catch(() => []);
    console.log(`  최종 예약 버튼 후보 ${dump.S8_finalReserveBtn.length}개`);
    dump.S8_finalReserveBtn.forEach(b => console.log(`    "${b.text}"`));

    // 11) 안전 닫기 (예약 발행 절대 클릭 안 함)
    const closeResult = await page.evaluate(() => {
      const closeBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const cls = (b.getAttribute('class') || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (cls.includes('close') || aria.includes('close') || aria.includes('닫기'));
      });
      if (closeBtn) { closeBtn.click(); return 'close-button'; }
      return 'not-found';
    }).catch(() => 'error');
    dump.S8_closeMethod = closeResult;
    await sleep(500);
    await safeKey(page, 'Escape', 300);
    await safeKey(page, 'Escape', 300);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // STAGE 9: 이미지 업로드 — 사진 버튼 + 파일 input 매핑 (이미지 마커 기능 준비)
  // ═══════════════════════════════════════════════════════════════════════
  await stage('이미지 업로드 매핑 — 사진 버튼 + filechooser', '9', async () => {
    await sleep(500);
    await focusBody(page);
    await safeKey(page, 'End', 100);
    await safeKey(page, 'Enter', 200);

    // 1) 툴바 이미지 관련 버튼
    dump.S9_imageBtns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).filter(b => {
        const dn = (b.getAttribute('data-name') || '').toLowerCase();
        const al = (b.getAttribute('aria-label') || '');
        const cls = (b.getAttribute('class') || '').toLowerCase();
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        return dn === 'image' || dn.includes('photo') || dn === 'picture' || dn.includes('image') ||
               /사진|이미지/.test(al) || cls.includes('image');
      }).map(b => ({
        dataName: b.getAttribute('data-name') || '',
        dataType: b.getAttribute('data-type') || '',
        ariaLabel: b.getAttribute('aria-label') || '',
        cls: (b.getAttribute('class') || '').substring(0, 150),
        text: b.textContent.trim().substring(0, 30),
      }));
    }).catch(() => []);
    console.log(`  이미지 버튼 후보 ${dump.S9_imageBtns.length}개`);
    dump.S9_imageBtns.forEach(b => console.log(`    [data-name=${b.dataName}] aria="${b.ariaLabel}"`));

    // 2) 페이지의 모든 file input
    dump.S9_fileInputs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input[type="file"]')).map(input => ({
        id: input.id || '',
        name: input.name || '',
        cls: (input.getAttribute('class') || '').substring(0, 100),
        accept: input.getAttribute('accept') || '',
        hidden: input.offsetParent === null,
        multiple: input.multiple,
      }));
    }).catch(() => []);
    console.log(`  file input ${dump.S9_fileInputs.length}개`);

    // 3) 사진 버튼 클릭 → filechooser 이벤트 캡처 (실제 파일 업로드는 X)
    const photoBtn = await page.$('button[data-name="image"]');
    if (photoBtn) {
      const fcPromise = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
      await photoBtn.click();
      const fileChooser = await fcPromise;
      if (fileChooser) {
        const elementHtml = await fileChooser.element().evaluate(el => el.outerHTML.substring(0, 500)).catch(() => '');
        dump.S9_fileChooser = {
          opened: true,
          isMultiple: fileChooser.isMultiple(),
          elementHtml,
        };
        await fileChooser.setFiles([]).catch(() => {});
        console.log(`  ✓ 사진 버튼 → file chooser 열림 (multiple=${fileChooser.isMultiple()})`);
      } else {
        dump.S9_fileChooser = { opened: false };
        console.log(`  ✗ file chooser 안 열림`);
      }
    } else {
      dump.S9_photoBtnError = '사진 버튼 (data-name="image") 못 찾음';
      console.log(`  ✗ 사진 버튼 못 찾음`);
    }
    await sleep(500);
    await safeEscapeAll(page);
  });

  // ── 결과 저장 ──────────────────────────────────────────────────────────
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dump, null, 2), 'utf8');
  const sizeKB = (fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1);
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(`✅ v4 분석 완료!  →  ${OUTPUT_FILE} (${sizeKB} KB)`);
  console.log('══════════════════════════════════════════════════════════════');
  console.log('\n브라우저는 3분간 열려있습니다. Ctrl+C로 즉시 종료 가능.');

  await sleep(3 * 60 * 1000);
  await browser.close();
}

main().catch(err => {
  console.error('❌ 치명적 오류:', err.message);
  if (Object.keys(dump).length > 1) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(dump, null, 2), 'utf8');
    console.log(`  부분 결과 저장됨: ${OUTPUT_FILE}`);
  }
  process.exit(1);
});
