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

async function fetchNaverNews(keyword, display = 5) {
  const clientId = process.env.NAVER_DATALAB_CLIENT_ID;
  const clientSecret = process.env.NAVER_DATALAB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return '';

  try {
    const res = await axios.get('https://openapi.naver.com/v1/search/news.json', {
      params: { query: keyword, display, sort: 'date' },
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
      },
      timeout: 8000,
    });
    const items = res.data.items || [];
    if (!items.length) return '';
    return items.map((item, i) => {
      const title = stripHtml(item.title);
      const desc = stripHtml(item.description);
      return `[기사${i + 1}] ${title}\n${desc}`;
    }).join('\n\n');
  } catch (err) {
    console.error('[NewsSearch] 실패:', err.message);
    return '';
  }
}

module.exports = { fetchNaverNews };
