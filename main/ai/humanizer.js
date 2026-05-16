const OpenAI = require('openai');

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function humanizePost(title, content) {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: `당신은 AI가 작성한 글을 자연스러운 사람 글로 바꾸는 전문가입니다.
다음 규칙을 반드시 따르세요:
1. AI 특유의 반복적 패턴과 과도한 나열 제거
2. 구어체와 개인적 표현 자연스럽게 삽입 ("솔직히", "사실", "그래서인지" 등)
3. 단락 길이를 다양하게 변경 (짧은 문장과 긴 문장 혼합)
4. 지나치게 완벽한 구조 의도적으로 깨기
5. 핵심 내용과 키워드는 유지
반드시 아래 형식으로만 응답하세요:
TITLE: [수정된 제목]
CONTENT: [수정된 본문]`
      },
      {
        role: 'user',
        content: `아래 글을 AI 감지를 우회할 수 있도록 더 자연스럽게 수정해주세요.

TITLE: ${title}
CONTENT: ${content}`
      }
    ],
    temperature: 0.9,
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
