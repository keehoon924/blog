CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT,
  style TEXT,
  image_style TEXT,
  title TEXT,
  content TEXT,
  processed_content TEXT,
  image_path TEXT,
  status TEXT DEFAULT 'draft',
  scheduled_at DATETIME,
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
