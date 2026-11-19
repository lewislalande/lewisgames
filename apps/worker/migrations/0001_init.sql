-- Quiz question bank and Pictionary word list.
CREATE TABLE questions (
  id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL,
  question TEXT NOT NULL,
  -- normalize(question): two questions differing only by case, accents or spacing are duplicates.
  question_key TEXT NOT NULL UNIQUE,
  answer TEXT NOT NULL,
  -- JSON array of accepted variants (a visual hint during the vote, never auto-validated).
  variants TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manuel',
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX questions_theme ON questions (theme);

CREATE TABLE words (word TEXT PRIMARY KEY);
