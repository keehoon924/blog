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

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

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

function savePost({ keyword, style, imageStyle, title, content, processedContent, status = 'draft', scheduledAt }) {
  db.run(
    `INSERT INTO posts (keyword, style, image_style, title, content, processed_content, status, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [keyword, style, imageStyle || null, title, content, processedContent || null, status, scheduledAt || null]
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
  const result = db.exec(`SELECT * FROM posts WHERE id = ${id}`);
  if (!result.length) return null;
  const [{ columns, values }] = result;
  return Object.fromEntries(columns.map((col, i) => [col, values[0][i]]));
}

function updatePostStatus(id, status) {
  const publishedAt = status === 'published' ? new Date().toISOString() : null;
  db.run('UPDATE posts SET status = ?, published_at = ? WHERE id = ?', [status, publishedAt, id]);
  persistDB();
}

module.exports = { initDB, savePost, getPosts, getPost, updatePostStatus };
