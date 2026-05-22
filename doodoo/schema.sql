CREATE TABLE IF NOT EXISTS invoice_comparison_sessions (
  id                   SERIAL PRIMARY KEY,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  mismatch_count       INT         NOT NULL DEFAULT 0,
  total_codes          INT         NOT NULL DEFAULT 0,
  client_file_count    INT         NOT NULL DEFAULT 0,
  supplier_file_count  INT         NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoice_files (
  id            SERIAL PRIMARY KEY,
  session_id    INT         NOT NULL REFERENCES invoice_comparison_sessions(id) ON DELETE CASCADE,
  role          TEXT        NOT NULL CHECK (role IN ('client', 'supplier')),
  filename      TEXT        NOT NULL,
  customer_name TEXT,
  order_no      TEXT,
  date          TEXT,
  invoice_type  TEXT
);

CREATE TABLE IF NOT EXISTS invoice_comparison_items (
  id            SERIAL PRIMARY KEY,
  session_id    INT     NOT NULL REFERENCES invoice_comparison_sessions(id) ON DELETE CASCADE,
  item_code     TEXT    NOT NULL,
  description   TEXT,
  client_qty    NUMERIC,
  supplier_qty  NUMERIC,
  is_match      BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id          SERIAL PRIMARY KEY,
  file_id     INT     NOT NULL REFERENCES invoice_files(id) ON DELETE CASCADE,
  item_code   TEXT    NOT NULL,
  description TEXT,
  qty         NUMERIC,
  unit_price  NUMERIC,
  subtotal    NUMERIC,
  is_gift     BOOLEAN NOT NULL DEFAULT false
);

-- ─── Creditor file system ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fs_nodes (
  id           UUID PRIMARY KEY,
  parent_id    UUID REFERENCES fs_nodes(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('creditor', 'folder', 'file')),
  name         TEXT NOT NULL,
  size_bytes   BIGINT,
  storage_path TEXT,
  phone        TEXT,
  email        TEXT,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fs_nodes_parent ON fs_nodes(parent_id);
