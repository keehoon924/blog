const OpenAI = require('openai');
const { app } = require('electron');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

function getGeneratedDir() {
  return path.join(app.getPath('userData'), 'generated-images');
}

function ensureDir() {
  const dir = getGeneratedDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// 카테고리별 DALL-E 3 프롬프트
const IMAGE_PROMPTS = {
  daily: (s) => `A warm, cozy lifestyle photo for a Korean blog post about "${s}". Natural soft lighting, personal and authentic feel, pastel colors. No text or watermarks.`,
  recipe: (s) => `Professional food photography of ${s}. Bright, appetizing, clean light background, restaurant quality plating. No text or watermarks.`,
  restaurant: (s) => `Atmospheric Korean restaurant photo for a blog post about ${s}. Moody warm lighting, beautiful food presentation. No text or watermarks.`,
  economy: (s) => `Clean, modern financial/business concept image for a blog post about "${s}". Professional, minimalist, subtle graph or chart elements. No text or watermarks.`,
  book: (s) => `Aesthetic flat lay photo with a book about "${s}". Warm natural light, cozy reading atmosphere, coffee mug and plants as props. No text or watermarks.`,
  car: (s) => `Professional automotive photography of ${s}. Dynamic angle, dramatic studio lighting, clean background. No text or watermarks.`,
  pet: (s) => `Adorable, heartwarming photo of ${s}. Warm natural light, playful and cute atmosphere. No text or watermarks.`,
  sports: (s) => `Dynamic sports action photo related to ${s}. High energy, dramatic composition, motion blur effect. No text or watermarks.`,
  other: (s) => `Professional, eye-catching blog thumbnail image for the topic "${s}". Clean modern design, vibrant colors, impactful composition. No text or watermarks.`,
};

// 카드뉴스용: 텍스트 오버레이를 위한 단순한 배경
const CARD_SUFFIX = ' Simple clean background with space for text overlay. Bold graphic design style, flat colors.';

async function generateImage(subject, category = 'other', style = 'blog') {
  const GENERATED_DIR = ensureDir();

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const promptFn = IMAGE_PROMPTS[category] || IMAGE_PROMPTS.other;
  let prompt = promptFn(subject);
  if (style === 'card') prompt += CARD_SUFFIX;

  let response;
  try {
    response = await client.images.generate({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });
  } catch (err) {
    // dall-e-3 접근 권한 없을 경우 dall-e-2로 폴백
    if (err.status === 400 || err.status === 404) {
      response = await client.images.generate({
        model: 'dall-e-2',
        prompt: prompt.slice(0, 900), // dall-e-2는 프롬프트 1000자 제한
        size: '1024x1024',
        n: 1,
      });
    } else {
      throw err;
    }
  }

  const imageUrl = response.data[0].url;

  const timestamp = Date.now();
  const filename = `img_${category}_${timestamp}.png`;
  const filepath = path.join(GENERATED_DIR, filename);

  const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(filepath, imgResponse.data);

  // base64로 변환해서 renderer에서 바로 표시 (file:// CSP 우회)
  const base64 = Buffer.from(imgResponse.data).toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  return { filepath, filename, dataUrl };
}

module.exports = { generateImage };
