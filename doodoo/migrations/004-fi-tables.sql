-- Fashion Index comparison sessions and results tables
CREATE TABLE IF NOT EXISTS fi_sessions (
  id             SERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_pairs    INT NOT NULL DEFAULT 0,
  mismatch_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fi_order_pairs (
  id              SERIAL PRIMARY KEY,
  session_id      INT NOT NULL REFERENCES fi_sessions(id) ON DELETE CASCADE,
  fi_order_id     VARCHAR(100) NOT NULL,
  fi_row_index    INT NOT NULL,
  doodoo_order_id VARCHAR(50),
  status          VARCHAR(30) NOT NULL
    CHECK (status IN ('compared', 'unlinked', 'doodoo_not_found'))
);

CREATE TABLE IF NOT EXISTS fi_item_comparisons (
  id            SERIAL PRIMARY KEY,
  pair_id       INT NOT NULL REFERENCES fi_order_pairs(id) ON DELETE CASCADE,
  product_code  TEXT         NOT NULL,
  product_name  TEXT         NOT NULL,
  fi_qty        NUMERIC      NOT NULL DEFAULT 0,
  doodoo_qty    NUMERIC      NOT NULL DEFAULT 0,
  status        VARCHAR(20)  NOT NULL
    CHECK (status IN ('matched', 'qty_mismatch', 'fi_only', 'doodoo_only'))
);
