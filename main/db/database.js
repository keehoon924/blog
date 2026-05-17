const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let db = null;
let dbPath = null;

async function initDB() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs({
    locateFile: file => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file)
  });

  dbPath = path.join(app.getPath('userData'), 'blog-auto.db');

  // 새 스키마(v2: subject/perspective)로 완전 재생성 — 기존 데이터 폐기
  db = new SQL.Database();
  db.run('DROP TABLE IF EXISTS posts');
  db.run('DROP TABLE IF EXISTS learning_data');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.run(schema);

  persistDB();
}

function persistDB() {
  if (db && dbPath) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

function savePost({ subject, perspective, style, category, imageStyle, title, content, processedContent, hashtags, status = 'draft', scheduledAt }) {
  db.run(
    `INSERT INTO posts (subject, perspective, style, category, image_style, title, content, processed_content, hashtags, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [subject || '', perspective || null, style, category || 'other', imageStyle || null, title, content, processedContent || null, hashtags || null, status, scheduledAt || null]
  );
  persistDB();
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result[0].values[0][0];
}

function getPosts() {
  const result = db.exec('SELECT * FROM posts ORDER BY created_at DESC LIMIT 100');
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function getPost(id) {
  const result = db.exec(`SELECT * FROM posts WHERE id = ${Number(id)}`);
  if (!result.length) return null;
  const [{ columns, values }] = result;
  return Object.fromEntries(columns.map((col, i) => [col, values[0][i]]));
}

function updatePostStatus(id, status) {
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  db.run('UPDATE posts SET status = ?, published_at = ? WHERE id = ?', [status, publishedAt, id]);
  persistDB();
}

function updatePostNaverUrl(id, naverUrl) {
  db.run('UPDATE posts SET naver_url = ? WHERE id = ?', [naverUrl, id]);
  persistDB();
}

function updatePostPerformance(id, views, likes, score) {
  db.run(
    'UPDATE posts SET views = ?, likes = ?, performance_score = ?, performance_checked_at = ? WHERE id = ?',
    [views, likes, score, new Date().toISOString(), id]
  );
  persistDB();
}

// Posts published 3+ days ago without performance check
function getPostsToCheck() {
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.exec(
    `SELECT * FROM posts WHERE status = 'published' AND naver_url IS NOT NULL AND naver_url != ''
     AND performance_checked_at IS NULL AND published_at < ?`,
    [threeDaysAgo]
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

// Get recent published posts in same category for "관련 글" section
function getRelatedPosts(category, excludeId, limit = 3) {
  const result = db.exec(
    `SELECT id, title, naver_url FROM posts
     WHERE status = 'published' AND category = ? AND id != ? AND naver_url IS NOT NULL AND naver_url != ''
     ORDER BY published_at DESC LIMIT ?`,
    [category, excludeId || 0, limit]
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function saveLearningData({ category, subject, title, titlePattern, style, views, likes, score }) {
  db.run(
    `INSERT INTO learning_data (category, subject, title, title_pattern, style, views, likes, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [category, subject || '', title, titlePattern, style, views, likes, score]
  );
  persistDB();
}

function getTopPerformingPosts(category, limit = 5) {
  const result = db.exec(
    `SELECT * FROM learning_data WHERE category = ? ORDER BY score DESC LIMIT ?`,
    [category, limit]
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

function getLearningData(category) {
  const result = db.exec(
    `SELECT * FROM learning_data WHERE category = ? ORDER BY created_at DESC LIMIT 20`,
    [category]
  );
  if (!result.length) return [];
  const [{ columns, values }] = result;
  return values.map(row => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
}

module.exports = {
  initDB, persistDB,
  savePost, getPosts, getPost,
  updatePostStatus, updatePostNaverUrl, updatePostPerformance,
  getPostsToCheck, getRelatedPosts,
  saveLearningData, getTopPerformingPosts, getLearningData,
};
