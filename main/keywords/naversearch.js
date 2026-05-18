const axios = require('axios');

function stripHtml(str) {
  return (str || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// 카테고리별 호출 API 목록
const CATEGORY_APIS = {
  daily:      ['blog'],
  recipe:     ['shop', 'blog'],
  restaurant: ['local', 'blog'],
  economy:    ['news'],
  book:       ['book', 'blog'],
  car:        ['shop', 'news'],
  pet:        ['blog', 'kin'],
  sports:     ['news', 'blog'],
  other:      ['news', 'kin'],
  comfort_morning: [],
  comfort_lunch:   [],
  comfort_evening: [],
};

async function callNaverApi(endpoint, query, clientId, clientSecret, display = 3) {
  try {
    const res = await axios.get(`https://openapi.naver.com/v1/search/${endpoint}`, {
      params: { query, display, sort: 'sim' },
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      timeout: 8000,
    });
    return res.data.items || [];
  } catch (err) {
    console.error(`[NaverSearch/${endpoint}] 실패:`, err.message);
    return [];
  }
}

function formatLocal(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const name = stripHtml(item.title);
    const cat  = item.category || '';
    const addr = item.roadAddress || item.address || '';
    const tel  = item.telephone || '';
    const desc = stripHtml(item.description);
    let out = `[장소${i + 1}] ${name}${cat ? ` (${cat})` : ''}`;
    if (addr) out += `\n주소: ${addr}`;
    if (tel)  out += ` | 전화: ${tel}`;
    if (desc) out += `\n설명: ${desc}`;
    return out;
  }).join('\n\n');
  return `=== 네이버 장소 정보 ===\n${lines}`;
}

function formatBlog(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const title = stripHtml(item.title);
    const desc  = stripHtml(item.description);
    return `[블로그${i + 1}] ${title}\n${desc}`;
  }).join('\n\n');
  return `=== 네이버 블로그 후기 ===\n${lines}`;
}

function formatShop(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const title  = stripHtml(item.title);
    const brand  = item.brand || '';
    const price  = item.lprice ? `${Number(item.lprice).toLocaleString()}원` : '';
    const desc   = stripHtml(item.description || item.category3 || '');
    let out = `[상품${i + 1}] ${title}`;
    if (brand) out += ` | 브랜드: ${brand}`;
    if (price) out += ` | 가격: ${price}`;
    if (desc)  out += `\n${desc}`;
    return out;
  }).join('\n\n');
  return `=== 쇼핑 정보 ===\n${lines}`;
}

function formatBook(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const title  = stripHtml(item.title);
    const author = item.author || '';
    const pub    = item.publisher || '';
    const desc   = stripHtml(item.description);
    let out = `[책${i + 1}] ${title}`;
    if (author || pub) out += ` (${[author, pub].filter(Boolean).join(' / ')})`;
    if (desc) out += `\n${desc}`;
    return out;
  }).join('\n\n');
  return `=== 책 정보 ===\n${lines}`;
}

function formatKin(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const title = stripHtml(item.title);
    const desc  = stripHtml(item.description);
    return `[지식iN${i + 1}] ${title}\n${desc}`;
  }).join('\n\n');
  return `=== 지식iN ===\n${lines}`;
}

function formatNews(items) {
  if (!items.length) return '';
  const lines = items.map((item, i) => {
    const title = stripHtml(item.title);
    const desc  = stripHtml(item.description);
    return `[기사${i + 1}] ${title}\n${desc}`;
  }).join('\n\n');
  return `=== 최신 뉴스 ===\n${lines}`;
}

const FORMATTERS = {
  local: formatLocal,
  blog:  formatBlog,
  shop:  formatShop,
  book:  formatBook,
  kin:   formatKin,
  news:  formatNews,
};

const ENDPOINTS = {
  local: 'local.json',
  blog:  'blog.json',
  shop:  'shop.json',
  book:  'book.json',
  kin:   'kin.json',
  news:  'news.json',
};

async function fetchNaverContext(keyword, category = 'other') {
  const clientId     = process.env.NAVER_DATALAB_CLIENT_ID;
  const clientSecret = process.env.NAVER_DATALAB_CLIENT_SECRET;
  if (!clientId || !clientSecret || !keyword) return '';

  const apis = CATEGORY_APIS[category] || CATEGORY_APIS.other;

  const results = await Promise.all(
    apis.map(api => callNaverApi(ENDPOINTS[api], keyword, clientId, clientSecret))
  );

  const sections = apis
    .map((api, i) => FORMATTERS[api](results[i]))
    .filter(Boolean);

  if (!sections.length) return '';
  console.log(`[NaverSearch] "${keyword}" (${category}): ${apis.join(', ')} 검색 완료`);
  return sections.join('\n\n');
}

module.exports = { fetchNaverContext };
