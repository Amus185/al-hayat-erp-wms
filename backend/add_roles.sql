-- Create missing roles
INSERT INTO roles (id, code, name, description) VALUES 
('role-manager-1234', 'manager', 'Manager', 'Store manager with broad access'),
('role-inventory-123', 'inventory_clerk', 'Inventory Clerk', 'Handles stock and warehouse ops'),
('role-sales-1234', 'sales_rep', 'Sales Representative', 'Handles customer orders and sales');

-- Assign permissions to Manager
-- 1111.. manage_users, 2222.. inventory, 3333.. transfers, 4444.. purchasing, 5555.. sales, 6666.. reports
INSERT INTO role_permissions (role_id, permission_id) VALUES 
('role-manager-1234', '11111111-1111-1111-1111-111111111111'),
('role-manager-1234', '22222222-2222-2222-2222-222222222222'),
('role-manager-1234', '33333333-3333-3333-3333-333333333333'),
('role-manager-1234', '44444444-4444-4444-4444-444444444444'),
('role-manager-1234', '55555555-5555-5555-5555-555555555555'),
('role-manager-1234', '66666666-6666-6666-6666-666666666666');

-- Assign permissions to Inventory Clerk (inventory, transfers, purchasing)
INSERT INTO role_permissions (role_id, permission_id) VALUES 
('role-inventory-123', '22222222-2222-2222-2222-222222222222'),
('role-inventory-123', '33333333-3333-3333-3333-333333333333'),
('role-inventory-123', '44444444-4444-4444-4444-444444444444');

-- Assign permissions to Sales Rep (sales)
INSERT INTO role_permissions (role_id, permission_id) VALUES 
('role-sales-1234', '55555555-5555-5555-5555-555555555555');
