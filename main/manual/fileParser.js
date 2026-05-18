const fs = require('fs');
const path = require('path');

// .txt / .md 파일 파싱
// 형식:
//   첫 줄(또는 "제목: ...") = 제목
//   가운데 = 본문 ([이미지] 마커 포함 가능)
//   마지막 # 으로 시작하는 연속 줄 = 해시태그
function parseContent(raw, filename = '') {
  const errors = [];
  const warnings = [];

  let text = (raw || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n');

  // 1) 제목 — 첫 비어있지 않은 줄 ("제목:" 접두사 자동 제거)
  let title = '';
  let titleLineIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    titleLineIdx = i;
    title = line.replace(/^제목\s*[:：]\s*/, '').trim();
    break;
  }
  if (!title) {
    errors.push('제목을 찾을 수 없습니다 (첫 줄에 제목을 입력하세요).');
    return { title: '', body: '', hashtags: '', imageMarkerCount: 0, charCount: 0, filename, errors, warnings };
  }

  // 2) 해시태그 — 파일 끝에서부터 # 으로 시작하는 연속 줄
  const hashtagsLines = [];
  let bodyEndIdx = lines.length;
  for (let i = lines.length - 1; i > titleLineIdx; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      hashtagsLines.unshift(line);
      bodyEndIdx = i;
    } else {
      break;
    }
  }
  const hashtags = hashtagsLines.join(' ').trim();

  // 3) 본문 — 제목 다음부터 해시태그 직전까지, 앞뒤 빈 줄 제거
  const bodyLines = lines.slice(titleLineIdx + 1, bodyEndIdx);
  while (bodyLines.length && !bodyLines[0].trim()) bodyLines.shift();
  while (bodyLines.length && !bodyLines[bodyLines.length - 1].trim()) bodyLines.pop();
  const body = bodyLines.join('\n').trim();

  if (!body) errors.push('본문이 비어있습니다.');

  // 4) [이미지] 마커 개수
  const imageMarkers = body.match(/\[이미지\]/g) || [];
  const imageMarkerCount = imageMarkers.length;

  // 5) 글자 수 (공백·마커 제외)
  const charCount = body
    .replace(/\[이미지\]/g, '')
    .replace(/\[인용구:[^\]]+\]/g, '')
    .replace(/\s+/g, '')
    .length;

  if (charCount < 500) warnings.push(`본문이 짧습니다 (${charCount}자, 1000자 이상 권장)`);
  if (!hashtags) warnings.push('해시태그가 없습니다 (#로 시작하는 줄을 끝에 추가하세요)');

  return { title, body, hashtags, imageMarkerCount, charCount, filename, errors, warnings };
}

function parseFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error('파일이 존재하지 않습니다: ' + filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  return parseContent(raw, path.basename(filePath));
}

module.exports = { parseContent, parseFile };
