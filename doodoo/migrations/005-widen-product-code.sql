-- Widen product_code from VARCHAR(50) to TEXT to handle long product codes
ALTER TABLE fi_item_comparisons ALTER COLUMN product_code TYPE TEXT;
