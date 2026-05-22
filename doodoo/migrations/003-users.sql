-- Users table with role-based access
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'read-only')),
  name          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed: first owner (password: doodoo@520)
INSERT INTO users (email, password_hash, role, name)
VALUES (
  '91crystalfam@gmail.com',
  '$2b$12$zC/YbhIXgkaOtKEgDoKlrebC.ezxh/Z4/WXE.JYD9DRJsHeI3zlBC',
  'owner',
  'Owner'
)
ON CONFLICT (email) DO NOTHING;
