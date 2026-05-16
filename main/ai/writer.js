const OpenAI = require('openai');

function getClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const STYLE_PROMPTS = {
  emotional: '감성적이고 공감을 유발하는 문체로, 독자의 감정에 호소하며 따뜻하고 진솔하게 작성해주세요.',
  informative: '정보 전달에 집중하는 문체로, 핵심 내용을 명확하고 구체적으로 전달해주세요.',
};

async function generatePost(keyword, style) {
  const client = getClient();
  const styleGuide = STYLE_PROMPTS[style] || STYLE_PROMPTS.informative;

  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: `당신은 네이버 블로그 전문 작가입니다. ${styleGuide}
네이버 블로그에 최적화된 글을 작성하며, 검색 노출과 독자 만족도를 동시에 고려합니다.
반드시 아래 형식으로만 응답하세요:
TITLE: [제목]
CONTENT: [본문]`
      },
      {
        role: 'user',
        content: `키워드: "${keyword}"
위 키워드로 네이버 블로그 글을 작성해주세요.
- 제목: 클릭을 유도하는 매력적인 제목 (30자 이내)
- 본문: 1500~2000자, 소제목 포함, 자연스러운 키워드 활용`
      }
    ],
    temperature: 0.8,
  });

  const text = response.choices[0].message.content;
  const titleMatch = text.match(/TITLE:\s*(.+)/);
  const contentMatch = text.match(/CONTENT:\s*([\s\S]+)/);

  return {
    title: titleMatch ? titleMatch[1].trim() : keyword,
    content: contentMatch ? contentMatch[1].trim() : text,
  };
}

module.exports = { generatePost };
