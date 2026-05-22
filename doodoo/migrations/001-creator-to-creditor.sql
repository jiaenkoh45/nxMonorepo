ALTER TABLE fs_nodes DROP CONSTRAINT IF EXISTS fs_nodes_type_check;
UPDATE fs_nodes SET type = 'creditor' WHERE type = 'creator';
ALTER TABLE fs_nodes ADD CONSTRAINT fs_nodes_type_check CHECK (type IN ('creditor', 'folder', 'file'));
