INSERT INTO permissions (id, code, description) VALUES 
('11111111-1111-1111-1111-111111111111', 'manage_users', 'Can manage users and roles'),
('22222222-2222-2222-2222-222222222222', 'manage_inventory', 'Can adjust stock and perform counts'),
('33333333-3333-3333-3333-333333333333', 'manage_transfers', 'Can create and approve transfers'),
('44444444-4444-4444-4444-444444444444', 'manage_purchasing', 'Can create POs and receive goods'),
('55555555-5555-5555-5555-555555555555', 'manage_sales', 'Can create sales orders and invoices'),
('66666666-6666-6666-6666-666666666666', 'view_reports', 'Can view analytical reports');

INSERT INTO roles (id, code, name, description) VALUES 
('77777777-7777-7777-7777-777777777777', 'admin', 'System Administrator', 'Full access to all modules');

INSERT INTO role_permissions (role_id, permission_id) VALUES 
('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111'),
('77777777-7777-7777-7777-777777777777', '22222222-2222-2222-2222-222222222222'),
('77777777-7777-7777-7777-777777777777', '33333333-3333-3333-3333-333333333333'),
('77777777-7777-7777-7777-777777777777', '44444444-4444-4444-4444-444444444444'),
('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555'),
('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666');

-- Password is "admin123" (bcrypt hash generated with node.js)
INSERT INTO users (id, email, password_hash, full_name, is_active) VALUES 
('88888888-8888-8888-8888-888888888888', 'admin@alhayat.com', '$2b$12$Z0/GkC.2rEOMiM92tF1x7eLIsO2x/Q0f53YQj1t42n1L.o/H3gQoG', 'Admin User', 1);

INSERT INTO user_roles (user_id, role_id) VALUES 
('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777');
