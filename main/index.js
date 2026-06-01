const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
require('dotenv').config(); // dev용 — 패키징 후엔 config.json에서 로드

const { initDB, savePost, getPosts, getPost, updatePostStatus, updatePostNaverUrl, getPostsToCheck } = require('./db/database');
const { generatePost, generatePostFreeform } = require('./ai/writer');
const { fetchNaverNews } = require('./keywords/newssearch');
const { fetchNaverContext } = require('./keywords/naversearch');
const { humanizePost } = require('./ai/humanizer');
const { getLearningBoost } = require('./ai/learner');
const { analyzeKeyword } = require('./keywords/analyzer');
const { publishToNaver, publishBatch } = require('./playwright/publisher');
const { loadConfig, saveConfig } = require('./config');
const { startScheduler, startAutoPublish, stopAutoPublish, runAutoPublish, runPerformanceCheck, getSchedulerStatus } = require('./scheduler');
const { generateImage } = require('./ai/imageGen');
const { fetchTrendingKeywords } = require('./keywords/trending');
const { parseContent: parseManualContent } = require('./manual/fileParser');
const { shell } = require('electron');

let mainWindow;

// 설정 파일의 API 키를 process.env로 동기화 (패키징 후 .env 없을 때 필요)
function syncEnvFromConfig() {
  const config = loadConfig();
  if (config.openaiKey)           process.env.OPENAI_API_KEY              = config.openaiKey;
  if (config.datalabClientId)     process.env.NAVER_DATALAB_CLIENT_ID     = config.datalabClientId;
  if (config.datalabClientSecret) process.env.NAVER_DATALAB_CLIENT_SECRET = config.datalabClientSecret;
  if (config.naverID)             process.env.NAVER_ID                    = config.naverID;
  if (config.naverPW)             process.env.NAVER_PW                    = config.naverPW;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: '네이버 블로그 자동화',
    backgroundColor: '#0f172a',
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'dashboard.html'));
}

app.whenReady().then(async () => {
  await initDB();
  syncEnvFromConfig();
  createWindow();
  startScheduler();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('navigate', (event, page) => {
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', `${page}.html`));
  return { success: true };
});

ipcMain.handle('post:generate', async (event, { subject, keyword, userPrompt, perspective, style, category }) => {
  try {
    const learningBoost = getLearningBoost(category || 'other');
    const effectiveKeyword = keyword || subject || '';
    let result;

    const searchContext = effectiveKeyword ? await fetchNaverContext(effectiveKeyword, category || 'other') : '';
    if (userPrompt) {
      result = await generatePostFreeform(userPrompt, category || 'other', searchContext, effectiveKeyword, learningBoost);
    } else {
      const { lsi, longtail } = await analyzeKeyword(effectiveKeyword);
      const relatedKeywords = [...longtail, ...lsi].slice(0, 6);
      result = await generatePost(effectiveKeyword, perspective || '', style, category || 'other', learningBoost, relatedKeywords, searchContext);
    }

    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:humanize', async (event, { title, content, subject }) => {
  try {
    const result = await humanizePost(title, content, subject || '');
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:save', async (event, postData) => {
  try {
    const id = savePost(postData);
    return { success: true, id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:publish-now', async (event, { postId, title, content, hashtags, category }) => {
  try {
    const config = loadConfig();
    const { getRelatedPosts } = require('./db/database');
    const relatedPosts = postId ? getRelatedPosts(category || 'other', postId) : [];
    await publishToNaver({ title, content, hashtags, relatedPosts, config, category });
    if (postId) updatePostStatus(postId, 'published');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('post:update-url', (event, { postId, naverUrl }) => {
  try {
    updatePostNaverUrl(postId, naverUrl);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('history:get', () => {
  try {
    const posts = getPosts();
    return { success: true, data: posts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:save', (event, settings) => {
  try {
    saveConfig(settings);
    syncEnvFromConfig(); // API 키 즉시 반영
    const config = loadConfig();
    if (config.autoMode) startAutoPublish();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('settings:get', () => {
  try {
    const config = loadConfig();
    return { success: true, data: config };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:get-status', () => {
  try {
    return { success: true, data: getSchedulerStatus() };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:set-auto-mode', (event, enabled) => {
  try {
    saveConfig({ autoMode: enabled });
    if (enabled) startAutoPublish(); else stopAutoPublish();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('scheduler:run-now', async (event, { category, style }) => {
  try {
    await runAutoPublish(category || 'daily', style || 'emotional');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('performance:check-now', async () => {
  try {
    await runPerformanceCheck();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('image:generate', async (event, { subject, category, style }) => {
  try {
    const result = await generateImage(subject, category || 'other', style || 'blog');
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('image:open-folder', () => {
  const dir = path.join(app.getPath('userData'), 'generated-images');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
  return { success: true };
});

ipcMain.handle('url:open-external', (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
  }
  return { success: true };
});

ipcMain.handle('keywords:fetch', async (event, { forceRefresh = false } = {}) => {
  try {
    const result = await fetchTrendingKeywords(forceRefresh);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('performance:pending-count', () => {
  try {
    const posts = getPostsToCheck();
    return { success: true, count: posts.length };
  } catch (err) {
    return { success: false, count: 0 };
  }
});

// ── 수동 예약 발행 (manual) ───────────────────────────────────────────────
ipcMain.handle('manual:parse-content', (event, { text, filename }) => {
  try {
    const parsed = parseManualContent(text, filename || '');
    return { success: true, data: parsed };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('manual:select-image', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '이미지 파일 선택',
      properties: ['openFile'],
      filters: [{ name: '이미지', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'heic', 'heif', 'webp'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return { success: true, path: result.filePaths[0] };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 이미지 썸네일 생성 — 파일 → base64 데이터 URL (미리보기용)
ipcMain.handle('manual:read-image-thumbnail', async (event, imagePath) => {
  try {
    if (!imagePath || !fs.existsSync(imagePath)) return { success: false, error: '파일 없음' };
    const buffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).slice(1).toLowerCase();
    const mimeMap = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', bmp: 'bmp', webp: 'webp', heic: 'heic', heif: 'heif' };
    const mime = mimeMap[ext] || 'jpeg';
    const dataUrl = `data:image/${mime};base64,${buffer.toString('base64')}`;
    return { success: true, dataUrl, sizeKB: Math.round(buffer.length / 1024) };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('manual:publish-all', async (event, { posts }) => {
  const config = loadConfig();
  const results = [];

  const batchPosts = posts.map((post, i) => ({
    title:        post.title,
    content:      post.body,        // manual은 body 필드 사용
    hashtags:     post.hashtags || '',
    relatedPosts: [],
    images:       post.images || [],
    scheduledAt:  post.scheduledAt || null,
    naverCategory: post.naverCategory || '',
    autoPublish:  false,
  }));

  await publishBatch(batchPosts, config, (i, total, title, status, error) => {
    const label = posts[i]?.filename || `글 ${i + 1}`;
    if (status === 'start')  event.sender.send('manual:progress', { index: i, total, label, status: 'publishing' });
    if (status === 'done')   { event.sender.send('manual:progress', { index: i, total, label, status: 'done' }); results.push({ filename: label, success: true }); }
    if (status === 'error')  { event.sender.send('manual:progress', { index: i, total, label, status: 'failed', error }); results.push({ filename: label, success: false, error }); }
  });

  return { success: true, results };
});

// ── 일괄 예약 발행 (bulk) ─────────────────────────────────────────────────────
const { parsePostFile } = require('./bulk/parser');

// 텍스트 파싱 (renderer에서 파일 읽어서 텍스트로 전달)
ipcMain.handle('bulk:parse-text', (event, text) => {
  try {
    const posts = parsePostFile(text);
    return { success: true, posts };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// 전체 예약 등록 실행 — publishBatch로 브라우저 1개에서 연속 발행
ipcMain.handle('bulk:run-all', async (event, { posts, startIndex = 0 }) => {
  const config = loadConfig();
  const results = [];

  // IPC 직렬화로 Date → ISO string이 되므로 date/time 문자열로 재구성
  const batchPosts = posts.map(post => {
    const [yr, mo, dy] = (post.date || '2026-01-01').split('-').map(Number);
    const [hh, mm]     = (post.time || '09:00').split(':').map(Number);
    return {
      title:        post.title,
      content:      post.content,
      hashtags:     post.tags || '',
      relatedPosts: [],
      images:       [],
      scheduledAt:  new Date(yr, mo - 1, dy, hh, mm, 0),
      naverCategory: post.category || '',
      autoPublish:  false,
    };
  });

  // 렌더러 webContents가 살아있을 때만 send (창 닫혀 destroyed면 무시)
  const safeSend = (channel, payload) => {
    try {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send(channel, payload);
    } catch (_) {}
  };

  try {
    await publishBatch(batchPosts, config, (i, total, title, status, error) => {
      const absIdx = startIndex + i;
      safeSend('bulk:progress', { index: absIdx, status, title, ...(error ? { error } : {}) });
      if (status === 'done')  results.push({ title, success: true });
      if (status === 'error') results.push({ title, success: false, error });
    });
  } catch (err) {
    safeSend('bulk:progress', { status: 'error', error: err.message });
    return { success: false, error: err.message };
  }

  safeSend('bulk:progress', { status: 'all_done', total: posts.length });
  return { success: true, results };
});
