const OpenAI = require('openai');

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function humanizePost(title, content, keyword = '') {
  const client = getClient();

  const keywordRule = keyword
    ? `\n【SEO 키워드 보존 — 절대 규칙】\n핵심 키워드: "${keyword}"\n1. 제목에 반드시 "${keyword}" 포함 유지\n2. 본문 첫 100자 이내에 "${keyword}" 등장 유지\n3. 본문 전체에 "${keyword}" 또는 동의어를 3~5회 자연스럽게 유지\n4. 키워드를 완전히 다른 단어로 대체하지 마세요`
    : '';

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: `당신은 AI 글을 자연스러운 사람 글로 바꾸는 전문가입니다.${keywordRule}

【반드시 지켜야 할 규칙】
1. **텍스트** 형식의 볼드 마킹 절대 제거하지 마세요 — 그대로 유지
2. [이미지: 설명] 플레이스홀더 절대 제거하지 마세요 — 그대로 유지
3. [인용구: 텍스트], [구분선], [짧은구분선] 마커 그대로 유지
4. #으로 시작하는 소제목 있으면 ** ** 형식으로 변환하세요
5. 마크다운 기호(#, ##, *, _, >) 완전 제거
6. HASHTAGS 섹션이 있으면 그대로 유지

【자연스럽게 바꾸는 규칙】
1. AI 특유의 나열형 패턴 제거 ("첫째, 둘째, 셋째" → 자연스러운 흐름으로)
2. 구어체 표현 삽입: "솔직히", "근데", "사실", "그래서인지", "어쩌다 보니", "이게 또"
3. 문장 길이 불규칙하게 (짧은 문장과 긴 문장 혼합)
4. 개인 경험 문구 추가: "제가 직접 해봤는데", "처음엔 저도 몰랐는데"
5. 너무 완벽한 논리 구조 의도적으로 깨기 — 약간의 망설임·반전 추가
6. 과도한 형용사·부사 줄이기 ("매우", "굉장히", "엄청나게" → 1회 이하로)
7. 불필요한 접속사 줄이기 ("그러나", "하지만" → 과용 금지)

반드시 아래 형식으로만 응답하세요:
TITLE: [수정된 제목]
CONTENT: [수정된 본문]`
      },
      {
        role: 'user',
        content: `아래 글을 AI 감지를 우회할 수 있도록 더 자연스러운 사람 말투로 수정해주세요.${keyword ? `\n키워드 "${keyword}"는 제목과 본문에 반드시 유지하세요.` : ''}
HASHTAGS 섹션이 있으면 그대로 유지하세요.

TITLE: ${title}
CONTENT: ${content}`
      }
    ],
    temperature: 0.9,
    max_tokens: 3500,
  });

  const text = response.choices[0].message.content;
  const titleMatch = text.match(/TITLE:\s*(.+)/);
  const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : title,
    content: contentMatch ? contentMatch[1].trim() : content,
  };
}

module.exports = { humanizePost };
