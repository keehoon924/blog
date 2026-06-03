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

function stripDividerMarkers(content) {
  return content.replace(/\[구분선\]|\[짧은구분선\]/g, '').replace(/\n{3,}/g, '\n\n');
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
    if (/^\s*\[(인용구:|이미지)/.test(line)) {
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

// \n을 Enter 키로 변환해서 입력
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

// SE5 툴바 버튼 클릭 — data-name 속성 기반
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

// 정렬 적용 (center | left | right)
// 클릭 기록 확인: 드롭다운 = button.se-align-center-toolbar-button, 옵션 = button.se-toolbar-option-align-{type}-button
async function applyAlign(page, alignType) {
  const dropdownBtn = await page.$('button.se-align-center-toolbar-button');
  if (dropdownBtn) {
    await dropdownBtn.click({ force: true });
  } else {
    await clickToolbarBtn(page, 'align-drop-down-with-justify', 'drop-down');
  }
  await page.waitForTimeout(300);
  const optBtn = await page.$(`button.se-toolbar-option-align-${alignType}-button`);
  if (optBtn) {
    await optBtn.click({ force: true });
    await page.waitForTimeout(300);
    return true;
  }
  return false;
}

// 이미지 업로드 — 사진 추가 버튼 클릭 → filechooser → 업로드 완료 확인
async function insertImage(page, imagePath) {
  if (!imagePath) throw new Error('이미지 경로 없음');

  const photoBtn = await page.$('button[data-name="image"]');
  if (!photoBtn) throw new Error('사진 추가 버튼 (data-name="image") 못 찾음');

  // 업로드 전 본문 이미지 개수
  const beforeCount = await page.evaluate(() =>
    document.querySelectorAll('.se-component-image img, .se-image-resource img, .se-component-content img').length
  );

  const fcPromise = page.waitForEvent('filechooser', { timeout: 8000 });
  await photoBtn.click();
  const fileChooser = await fcPromise.catch(() => null);
  if (!fileChooser) throw new Error('파일 선택 다이얼로그 안 열림 (사진 버튼 클릭 후)');

  await fileChooser.setFiles(imagePath);
  console.log(`[insertImage] 업로드 시작: ${imagePath.split(/[\\/]/).pop()}`);

  // 업로드 완료 대기 — 이미지 개수 증가까지 (최대 20초)
  let uploaded = false;
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(1000);
    const afterCount = await page.evaluate(() =>
      document.querySelectorAll('.se-component-image img, .se-image-resource img, .se-component-content img').length
    );
    if (afterCount > beforeCount) {
      uploaded = true;
      console.log(`[insertImage] ✓ 업로드 완료 (${i + 1}초)`);
      break;
    }
  }
  if (!uploaded) throw new Error(`이미지 업로드 시간 초과 (20초): ${imagePath}`);

  // 커서를 이미지 다음 줄로 (ArrowDown + End)
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.waitForTimeout(300);
  return true;
}

// 인용구 삽입 — 모든 이동은 클릭으로 (Enter/ArrowDown 사용 금지)
// quoteRaw 형식: "인용문 | – 출처명" 또는 "인용문"
async function insertQuote(page, quoteRaw) {
  const pipeIdx = quoteRaw.indexOf(' | ');
  const quoteText = pipeIdx !== -1 ? quoteRaw.slice(0, pipeIdx).trim() : quoteRaw.trim();
  const attribution = pipeIdx !== -1 ? quoteRaw.slice(pipeIdx + 3).trim() : '';

  const clicked = await clickToolbarBtn(page, 'quotation', 'icon-select');
  if (!clicked) {
    // 툴바 버튼 없을 때 대체 텍스트로 삽입
    const full = attribution ? `❝ ${quoteText} ❞\n— ${attribution}` : `❝ ${quoteText} ❞`;
    await slowType(page, full);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    return;
  }

  // 인용구 블록이 생성될 때까지 대기
  await page.waitForTimeout(800);

  // ── 1단계: 인용구 내용 영역 클릭 후 입력 ──
  await page.evaluate(() => {
    const mods = document.querySelectorAll('.se-module-quotation');
    const last = mods[mods.length - 1];
    if (!last) return;
    // 첫 번째 텍스트 단락 (내용 입력 영역)
    const para = last.querySelector('.se-text-paragraph');
    if (para) para.click();
  });
  await page.waitForTimeout(400);
  await page.keyboard.type(quoteText, { delay: 18 });

  // ── 2단계: 출처 영역 클릭 후 입력 ──
  if (attribution) {
    await page.evaluate(() => {
      const mods = document.querySelectorAll('.se-module-quotation');
      const last = mods[mods.length - 1];
      if (!last) return;
      // 출처는 cite 태그 안 또는 두 번째 텍스트 단락
      const cite = last.querySelector('cite .se-text-paragraph')
        || last.querySelector('cite')
        || last.querySelectorAll('.se-text-paragraph')[1];
      if (cite) cite.click();
    });
    await page.waitForTimeout(400);
    await page.keyboard.type(attribution, { delay: 18 });
  }

  // ── 3단계: 인용구 블록 바깥 본문 영역 클릭으로 탈출 ──
  await page.waitForTimeout(400);
  const exited = await page.evaluate(() => {
    const mods = document.querySelectorAll('.se-module-quotation');
    const last = mods[mods.length - 1];
    if (!last) return false;

    // 인용구 블록 다음 형제 요소에서 클릭 가능한 단락 찾기
    let sibling = last.nextElementSibling;
    while (sibling) {
      const para = sibling.querySelector
        ? (sibling.querySelector('.se-text-paragraph') ||
           (sibling.classList && sibling.classList.contains('se-text-paragraph') ? sibling : null))
        : null;
      if (para) {
        para.click();
        return true;
      }
      sibling = sibling.nextElementSibling;
    }
    return false;
  });

  if (!exited) {
    // 다음 형제가 없으면 메인 섹션 끝 부분 클릭
    const box = await page.evaluate(() => {
      const main = document.querySelector('.se-main-section');
      if (!main) return null;
      const rect = main.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height - 40 };
    });
    if (box) {
      await page.mouse.click(box.x, box.y);
    }
  }
  await page.waitForTimeout(500);
}

// 본문 마커([인용구:...], [이미지]) 파싱 후 타이핑
// images: 사용자 [이미지] 마커 순서대로 매칭할 로컬 파일 경로 배열
async function typeContentWithMarkers(page, content, images = []) {
  const stage1 = stripContentArtifacts(content);
  const stage2 = stripDividerMarkers(stage1);
  const stage3 = stripImagePlaceholders(stage2);  // AI [이미지:hint] 제거, 사용자 [이미지]는 보존
  const cleaned = makeReadable(stage3);
  // 인용구(콜론 있음) + 이미지(콜론 없음, 단독) 통합 매칭
  const markerRegex = /\[(인용구:[^\]]+|이미지)\]/g;
  let lastIndex = 0;
  let imageIndex = 0;
  let match;

  while ((match = markerRegex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      await typeWithFormatting(page, cleaned.slice(lastIndex, match.index));
    }

    const marker = match[1];
    if (marker.startsWith('인용구:')) {
      await insertQuote(page, marker.slice(3).trim());
      // 인용구 탈출 후 가운데 정렬 재적용
      await applyAlign(page, 'center');
      await page.waitForTimeout(300);
    } else if (marker === '이미지') {
      if (imageIndex < images.length) {
        await insertImage(page, images[imageIndex]);
        imageIndex++;
      } else {
        console.warn(`[이미지] 마커 ${imageIndex + 1}번째이지만 업로드할 이미지 부족 — 건너뜀`);
      }
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
  await page.keyboard.press('Control+b');
  await page.keyboard.type('▼ 함께 읽으면 좋은 글', { delay: 20 });
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Enter');
  for (const post of relatedPosts) {
    await page.keyboard.type(`• ${post.title}`, { delay: 20 });
    await page.keyboard.press('Enter');
    if (post.naver_url) {
      await page.keyboard.type(`  ${post.naver_url}`, { delay: 15 });
      await page.keyboard.press('Enter');
    }
  }
}

async function doLogin(page, id, pw) {
  // 로그인 페이지로 직접 이동
  await page.goto('https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com%2F', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#id', { timeout: 15000 });
  await page.waitForTimeout(500);

  // ID 입력 — 자동완성 지우고 한 글자씩 입력
  await page.click('#id');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  for (const char of id) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }

  // PW 입력 — 자동완성 지우고 한 글자씩 입력
  await page.click('#pw');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  for (const char of pw) {
    await page.keyboard.type(char);
    await page.waitForTimeout(30 + Math.floor(Math.random() * 70));
  }
  await page.waitForTimeout(500);
  await page.click('.btn_login');

  // 보안문자 발생 시 사용자가 직접 해결할 때까지 대기 (최대 3분)
  await page.waitForFunction(
    () => !window.location.hostname.includes('nid.naver.com'),
    { timeout: 180000 }
  );
}

// ── 프레임 헬퍼 ──────────────────────────────────────────────────────────────
// 모든 프레임에서 element 탐색 → { el, frame } 반환
async function findInFrames(page, selector) {
  for (const frame of page.frames()) {
    try {
      const el = await frame.$(selector);
      if (el) return { el, frame };
    } catch (_) {}
  }
  return null;
}

// 모든 프레임에서 element 대기 (timeout ms)
async function waitInFrames(page, selector, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const el = await frame.$(selector);
        if (el) return { el, frame };
      } catch (_) {}
    }
    await page.waitForTimeout(300);
  }
  throw new Error(`Timeout: "${selector}" not found in any frame`);
}

// 모든 프레임에서 selectOption 적용
async function selectInFrames(page, selector, value) {
  for (const frame of page.frames()) {
    try {
      const el = await frame.$(selector);
      if (el) { await frame.selectOption(selector, value); return true; }
    } catch (_) {}
  }
  return false;
}

// 모든 프레임에서 evaluate 실행 (첫 번째 성공 프레임 결과 반환)
async function evalInFrames(page, fn, ...args) {
  for (const frame of page.frames()) {
    try {
      const result = await frame.evaluate(fn, ...args);
      if (result && result !== false) return result;
    } catch (_) {}
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────────────

// 자동 발행 — 발행 다이얼로그 진입 후 다이얼로그 내 '발행' 버튼 클릭
async function autoFinalizePublish(page) {
  const found = await findInFrames(page, 'button.publish_btn__m9KHH');
  if (!found) throw new Error('우상단 발행 버튼을 찾을 수 없습니다.');
  await found.el.click({ force: true });

  await waitInFrames(page, 'input[name="radio_time"], input#radio_time2', 10000);
  await page.waitForTimeout(1800);

  await clickDialogPublishBtn(page);
  try { await page.waitForTimeout(5000); } catch (_) {}
}

// layer_popup 드롭다운 강제 닫기 (layer_publish 다이얼로그 제외) — 모든 프레임
async function forceCloseLayerPopup(page) {
  for (const frame of page.frames()) {
    try {
      await frame.evaluate(() => {
        document.querySelectorAll('[class*="layer_popup"]').forEach(el => {
          if (el.className.includes('layer_publish')) return;
          [...el.classList].filter(c => c.includes('is_show')).forEach(c => el.classList.remove(c));
          el.style.display = 'none';
        });
      });
    } catch (_) {}
  }
  await page.waitForTimeout(400);
}

// 다이얼로그 내 발행 확인 버튼 클릭 (confirm_btn__WEaBq) — evaluate 직접 click()
async function clickDialogPublishBtn(page) {
  // 최대 3회 시도
  for (let attempt = 0; attempt < 3; attempt++) {
    const clicked = await evalInFrames(page, () => {
      const btn = document.querySelector('button.confirm_btn__WEaBq');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (clicked) {
      console.log(`[발행 버튼] evaluate click() 성공 (시도 ${attempt + 1})`);
      await page.waitForTimeout(3000);
      // 다이얼로그 닫혔으면 완료
      const stillOpen = await evalInFrames(page, () => {
        const r = document.querySelector('input#radio_time2');
        return r ? r.getBoundingClientRect().width > 0 : false;
      });
      if (!stillOpen) return { clicked: true };
      console.warn('[발행 버튼] 다이얼로그 아직 열림 — 재시도');
    } else {
      console.warn(`[발행 버튼] 버튼 못 찾음 — 재시도 (${attempt + 1})`);
      await page.waitForTimeout(1000);
    }
  }
  return { clicked: true };
}

// 카테고리 설정 — evaluate 기반, 드롭다운 닫힘 후 발행 다이얼로그 유지
async function selectNaverCategory(page, categoryName) {
  if (!categoryName || !categoryName.trim()) return { skipped: true };
  const name = categoryName.trim();
  try {
    // 카테고리 드롭다운 열기
    const opened = await evalInFrames(page, () => {
      const btn = document.querySelector('button.selectbox_button__jb1Dt');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!opened) return { error: '카테고리 드롭다운 버튼 없음' };
    await page.waitForTimeout(1000);

    // 카테고리 항목 클릭 (label.radio_label__mB6ia 텍스트 매칭)
    const clicked = await evalInFrames(page, (targetName) => {
      const labels = Array.from(document.querySelectorAll('label.radio_label__mB6ia'));
      const visible = labels.filter(l => l.getBoundingClientRect().height > 0);
      const found = visible.find(l => {
        const txt = l.textContent.trim();
        return txt === targetName || txt.includes(targetName);
      });
      if (found) {
        found.click();
        // 같은 span 안의 radio input도 클릭 (클릭 기록 [11][12] 순서)
        const radio = found.closest('span')?.querySelector('input.radio_item__PIBr7');
        if (radio) radio.click();
        return found.textContent.trim();
      }
      // 없으면 사용 가능 목록 반환
      return { available: visible.map(l => l.textContent.trim()) };
    }, name);

    if (!clicked) return { error: '카테고리 드롭다운 열기 실패' };
    if (clicked.available) {
      console.warn(`[카테고리] "${name}" 없음. 사용 가능: ${clicked.available.slice(0, 10).join(', ')}`);
      await page.keyboard.press('Escape');
      return { error: `"${name}" 없음` };
    }
    console.log(`[카테고리] "${clicked}" 클릭됨`);
    await page.waitForTimeout(800);
    return { clicked: name };
  } catch (err) {
    return { error: err.message };
  }
}

// 예약 발행 — scheduledAt: Date 객체 또는 ISO 문자열
// 네이버 제약: 분은 10분 단위 (00/10/20/30/40/50), 과거 시간 불가
async function autoFinalizeScheduledPublish(page, scheduledAt, naverCategory = '') {
  const target = scheduledAt instanceof Date ? scheduledAt : new Date(scheduledAt);
  if (isNaN(target.getTime())) throw new Error('예약 시간 형식 오류: ' + scheduledAt);

  const targetYear  = target.getFullYear();
  const targetMonth = target.getMonth() + 1;
  const targetDay   = target.getDate();
  const targetHour  = target.getHours();
  const rawMinute   = target.getMinutes();
  // 분 10분 단위 반올림 (네이버 제약), 최대 50
  const targetMinute = Math.min(Math.round(rawMinute / 10) * 10, 50);

  // 1) 우상단 발행 버튼 클릭 — 모든 프레임 탐색
  const topFound = await findInFrames(page, 'button.publish_btn__m9KHH');
  if (!topFound) throw new Error('우상단 발행 버튼을 찾을 수 없습니다.');
  await topFound.el.click({ force: true });

  // 다이얼로그 열림 확인
  await waitInFrames(page, 'input#radio_time2, input[name="radio_time"]', 10000);
  await page.waitForTimeout(1800);

  // 2) 카테고리 선택
  if (naverCategory) {
    const catResult = await selectNaverCategory(page, naverCategory);
    if (catResult.error) console.warn('[카테고리 설정] ' + catResult.error);
    else if (catResult.clicked) console.log('[카테고리 설정] "' + naverCategory + '" 선택됨');
    await page.waitForTimeout(500);
  }

  // 3) "예약" 라벨 + radio_time2 클릭 (클릭 기록 [13][14] 순서)
  const reserved = await evalInFrames(page, () => {
    // 텍스트가 "예약"인 label 클릭
    const labels = Array.from(document.querySelectorAll('label.radio_label__mB6ia'));
    const lbl = labels.find(l => l.textContent.trim() === '예약');
    if (lbl) lbl.click();
    // input#radio_time2 직접 클릭
    const radio = document.querySelector('input#radio_time2');
    if (radio) radio.click();
    return !!(lbl || radio);
  });
  if (!reserved) throw new Error('예약 라디오를 찾을 수 없습니다.');
  await page.waitForTimeout(1000);

  // 4) 날짜 input 클릭
  const dateClicked = await evalInFrames(page, () => {
    const el = document.querySelector('input.input_date__QmA0s');
    if (el) { el.click(); return true; }
    return false;
  });
  if (!dateClicked) throw new Error('날짜 input을 찾을 수 없습니다.');
  await page.waitForTimeout(800);

  // 5) 목표 달까지 이동
  for (let i = 0; i < 24; i++) {
    const current = await evalInFrames(page, () => {
      const y = document.querySelector('.ui-datepicker-year');
      const m = document.querySelector('.ui-datepicker-month');
      if (!y || !m) return null;
      return {
        year:  parseInt(y.textContent.trim(), 10),
        month: parseInt(m.textContent.replace('월', '').trim(), 10),
      };
    });
    if (!current) throw new Error('캘린더 헤더(년/월)를 읽을 수 없습니다.');
    if (current.year === targetYear && current.month === targetMonth) break;
    if (current.year > targetYear || (current.year === targetYear && current.month > targetMonth)) {
      throw new Error(`목표 ${targetYear}-${targetMonth}이(가) 현재 표시보다 과거 — 예약 불가`);
    }
    const nextClicked = await evalInFrames(page, () => {
      const btn = document.querySelector('button.ui-datepicker-next:not(.ui-state-disabled)');
      if (btn) { btn.click(); return true; }
      return false;
    });
    if (!nextClicked) throw new Error('다음달 버튼이 비활성화');
    await page.waitForTimeout(400);
  }

  // 6) 목표 날짜 클릭
  const dayResult = await evalInFrames(page, (day) => {
    const buttons = Array.from(document.querySelectorAll('.ui-datepicker td:not(.ui-state-disabled) > button.ui-state-default'));
    const btn = buttons.find(b => b.textContent.trim() === String(day));
    if (!btn) return { error: `${day}일 클릭 불가` };
    btn.click();
    return { clicked: true };
  }, targetDay);
  if (!dayResult || dayResult.error) throw new Error(dayResult?.error || '날짜 클릭 실패');
  await page.waitForTimeout(800);

  // 7) 시간 select — React 호환 네이티브 setter + input/change 이벤트 모두 발사
  await evalInFrames(page, (h) => {
    const sel = document.querySelector('select.hour_option__J_heO');
    if (!sel) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativeSetter.call(sel, h);
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, String(targetHour).padStart(2, '0'));
  await page.waitForTimeout(500);

  // 8) 분 select — 동일 방식
  await evalInFrames(page, (m) => {
    const sel = document.querySelector('select.minute_option__Vb3xB');
    if (!sel) return false;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    nativeSetter.call(sel, m);
    sel.dispatchEvent(new Event('input',  { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, String(targetMinute).padStart(2, '0'));
  await page.waitForTimeout(500);

  // 9) 다이얼로그 내 "발행" 버튼 클릭 — evaluate 직접 click() (좌표 의존 제거)
  await clickDialogPublishBtn(page);

  // 예약 등록 완료 대기 — 네이버가 페이지를 닫거나 이동시킬 수 있으므로 try-catch
  try { await page.waitForTimeout(5000); } catch (_) {}
}

// '작성 중인 글이 있습니다' 팝업이 뜨면 '취소' 클릭 (새 글로 시작) — 모든 프레임 탐색
async function dismissDraftPopup(page) {
  try {
    for (const frame of page.frames()) {
      try {
        const clicked = await frame.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button'));
          // .se-popup-container 안 취소 버튼 우선
          let btn = btns.find(b => b.textContent.trim() === '취소' && b.closest('.se-popup-container'));
          // 없으면 화면에 보이는 취소 버튼
          if (!btn) btn = btns.find(b => b.textContent.trim() === '취소' && b.offsetParent !== null);
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (clicked) break;
      } catch (_) {}
    }
    await page.waitForTimeout(500);
  } catch (_) {}
}

// 네이버 에디터 우측 '도움말' 패널 닫기 — 최대 10회 재시도 (iframe 로딩 대기)
async function dismissHelpPanel(page) {
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const frames = [page, ...page.frames()];
      let found = false;
      for (const ctx of frames) {
        try {
          const ok = await ctx.evaluate(() => {
            const btn = document.querySelector('button.se-help-panel-close-button');
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (ok) { found = true; break; }
        } catch (_) {}
      }
      if (found) {
        console.log('[도움말] 닫기 완료');
        await page.waitForTimeout(600);
        break;
      }
      await page.waitForTimeout(300);
    }
  } catch (_) {}
}

async function publishToNaver({ title, content, hashtags, relatedPosts, config, category = 'other', autoPublish = false, images = [], scheduledAt = null, naverCategory = '' }) {
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;

  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });

  const contextOptions = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  };

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const writeUrl = 'https://blog.naver.com/GoBlogWrite.naver';

  // 항상 로그인 페이지부터 시작 — 보안문자가 뜨면 사용자가 직접 해결 후 자동 진행
  await doLogin(page, naverID, naverPW);
  await page.waitForTimeout(2000);
  await context.storageState({ path: SESSION_FILE });
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.waitForTimeout(2500);

  // ── Step 0: 도움말 패널 + 작성 중인 글 팝업 닫기 ──
  await dismissHelpPanel(page);
  await dismissDraftPopup(page);
  await page.waitForTimeout(800);

  // ── Step 1: 폰트 크기 19 설정 (클릭 기록 순서: 도움말닫기 → 폰트19 → 가운데정렬 → 제목클릭) ──
  const fontSizeBtn = await page.$('button.se-font-size-code-toolbar-button');
  if (fontSizeBtn) {
    await fontSizeBtn.click({ force: true });
    await page.waitForTimeout(400);
    const fs19 = await page.$('button[class*="font-size-code-fs19"]');
    if (fs19) await fs19.click({ force: true });
    await page.waitForTimeout(300);
  }

  // ── Step 2: 가운데 정렬 설정 ──
  await applyAlign(page, 'center');
  await page.waitForTimeout(400);

  // ── Step 3: 제목 클릭 후 입력 ──
  const titleEl = await page.$('.se-title-text .se-text-paragraph');
  if (titleEl) {
    await titleEl.click({ force: true });
    await page.waitForTimeout(400);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);
    for (const char of title) {
      await page.keyboard.type(char);
      await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
    }
  }
  await page.waitForTimeout(500);

  // ── Step 4: 본문 클릭 ──
  const bodyEl = await page.$('.se-module-text:not(.se-title-text) .se-text-paragraph');
  if (bodyEl) await bodyEl.click({ force: true });
  await page.waitForTimeout(400);

  // ── Step 5: 본문 입력 (이미지 마커 포함) ──
  await typeContentWithMarkers(page, content, images);

  // ── Step 4: 커서를 끝으로 ──
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(200);

  // ── Step 5: 해시태그 ──
  await typeHashtags(page, hashtags);

  // ── Step 6: 관련 글 ──
  await typeRelatedPosts(page, relatedPosts);

  // ── Step 7: 발행 분기 — 예약 발행 / 즉시 자동 발행 / 수동 (브라우저 열린 채로) ──
  if (scheduledAt) {
    await page.waitForTimeout(1500);
    await autoFinalizeScheduledPublish(page, scheduledAt, naverCategory);
  } else if (autoPublish) {
    await page.waitForTimeout(1500);
    await autoFinalizePublish(page);
  }
}

// 브라우저 1개로 로그인 1번 → 여러 글 연속 발행
async function publishBatch(posts, config, onProgress) {
  const naverID = config.naverID || process.env.NAVER_ID;
  const naverPW = config.naverPW || process.env.NAVER_PW;
  if (!naverID || !naverPW) throw new Error('네이버 아이디/비밀번호가 설정되지 않았습니다.');

  const browser = await chromium.launch({
    headless: false,
    slowMo: 20,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: null,
    extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
  });

  const writeUrl = 'https://blog.naver.com/GoBlogWrite.naver';

  // 로그인 1번
  let page = await context.newPage();
  await doLogin(page, naverID, naverPW);
  await page.waitForTimeout(2000);
  await context.storageState({ path: SESSION_FILE });

  const total = posts.length;

  for (let i = 0; i < total; i++) {
    const post = posts[i];
    if (onProgress) onProgress(i, total, post.title, 'start');
    try {
      // 예약 발행 후 네이버가 페이지를 닫을 수 있음 — 닫혀 있으면 새 페이지 생성
      if (page.isClosed()) {
        page = await context.newPage();
      }
      // 페이지 이동 시 "떠나겠습니까?" 다이얼로그 자동 수락
      page.once('dialog', dialog => dialog.accept().catch(() => {}));
      await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(3000);

      // 메인 + 모든 하위 프레임 목록 (에디터가 iframe 안에 있을 수 있음)
      const frames = [page, ...page.frames()];

      // [1] 도움말 닫기 (첫 글만 뜸 — 없으면 자동 건너뜀)
      await dismissHelpPanel(page);
      await dismissDraftPopup(page);
      await page.waitForTimeout(800);

      // [2][3] 폰트 크기 19 — evaluate 네이티브 click()
      for (const ctx of frames) {
        try {
          const ok = await ctx.evaluate(() => {
            const btn = document.querySelector('button.se-font-size-code-toolbar-button');
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (ok) break;
        } catch (_) {}
      }
      await page.waitForTimeout(500);
      for (const ctx of frames) {
        try {
          const ok = await ctx.evaluate(() => {
            const btn = document.querySelector('button[class*="font-size-code-fs19"]');
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (ok) break;
        } catch (_) {}
      }
      await page.waitForTimeout(300);

      // [4][5] 가운데 정렬 — evaluate 네이티브 click()
      for (const ctx of frames) {
        try {
          const ok = await ctx.evaluate(() => {
            const btn = document.querySelector('button.se-align-center-toolbar-button');
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (ok) break;
        } catch (_) {}
      }
      await page.waitForTimeout(400);
      for (const ctx of frames) {
        try {
          const ok = await ctx.evaluate(() => {
            const btn = document.querySelector('button.se-toolbar-option-align-center-button');
            if (btn) { btn.click(); return true; }
            return false;
          });
          if (ok) break;
        } catch (_) {}
      }
      await page.waitForTimeout(400);

      // [6] 제목 클릭 후 입력 — frame.$().click({ force:true }) : mousedown/up/click 전체 시퀀스 전송
      let titleEl = null;
      for (const frame of page.frames()) {
        try {
          titleEl = await frame.$('.se-title-text .se-text-paragraph');
          if (titleEl) break;
        } catch (_) {}
      }
      if (titleEl) {
        await titleEl.click({ force: true });
        await page.waitForTimeout(400);
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);
        for (const char of post.title) {
          await page.keyboard.type(char);
          await page.waitForTimeout(20 + Math.floor(Math.random() * 30));
        }
      }
      await page.waitForTimeout(500);

      // [7] 본문 클릭 — frame.$().click({ force:true })
      let bodyEl = null;
      for (const frame of page.frames()) {
        try {
          const paras = await frame.$$('.se-text-paragraph');
          for (const p of paras) {
            const inTitle = await p.evaluate(el => !!el.closest('.se-title-text'));
            if (!inTitle) { bodyEl = p; break; }
          }
          if (bodyEl) break;
        } catch (_) {}
      }
      if (bodyEl) await bodyEl.click({ force: true });
      await page.waitForTimeout(400);

      // 본문 입력
      await typeContentWithMarkers(page, post.content, post.images || []);
      await page.keyboard.press('Control+End');
      await page.waitForTimeout(200);

      // 해시태그
      await typeHashtags(page, post.hashtags);

      // 발행
      if (post.scheduledAt) {
        try { await page.waitForTimeout(1500); } catch (_) {}
        await autoFinalizeScheduledPublish(page, post.scheduledAt, post.naverCategory || '');
      } else if (post.autoPublish) {
        try { await page.waitForTimeout(1500); } catch (_) {}
        await autoFinalizePublish(page);
      }

      if (onProgress) onProgress(i, total, post.title, 'done');
    } catch (err) {
      if (onProgress) onProgress(i, total, post.title, 'error', err.message);
    }
  }

  await browser.close();
}

module.exports = { publishToNaver, publishBatch };
