-- =========================================================
-- Al Hayat ERP+WMS — Enhanced Seed Data
-- Run AFTER schema.sql on Supabase SQL Editor
-- =========================================================

-- ── Permissions ─────────────────────────────────────
INSERT INTO permissions (code, description) VALUES
  ('users.manage',        'Create and manage user accounts'),
  ('products.read',       'View products and catalog'),
  ('products.write',      'Create and edit products'),
  ('inventory.read',      'View inventory and stock levels'),
  ('inventory.adjust',    'Adjust stock and run counts'),
  ('transfers.create',    'Create transfer requests'),
  ('transfers.approve',   'Approve or reject transfers'),
  ('transfers.dispatch',  'Dispatch approved transfers'),
  ('transfers.receive',   'Receive incoming transfers'),
  ('purchasing.write',    'Create purchase orders'),
  ('purchasing.approve',  'Approve purchase orders'),
  ('sales.write',         'Create sales orders and invoices'),
  ('reports.read',        'View management reports'),
  ('audit.read',          'View audit logs'),
  ('branches.manage',     'Manage branch configuration')
ON CONFLICT (code) DO NOTHING;

-- ── Roles ───────────────────────────────────────────
INSERT INTO roles (name, description) VALUES
  ('SUPER_ADMIN',       'Full system access'),
  ('WAREHOUSE_MANAGER', 'Warehouse operations lead'),
  ('BRANCH_MANAGER',    'Branch operations lead'),
  ('SALES_STAFF',       'Front-line sales'),
  ('INVENTORY_STAFF',   'Warehouse floor staff')
ON CONFLICT (name) DO NOTHING;

-- ── Super Admin gets ALL permissions ────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT DO NOTHING;

-- ── Default Super Admin User ─────────────────────────
-- Email: admin@alhayat.com | Password: Admin@1234
INSERT INTO users (id, email, full_name, password_hash, role_id, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  'admin@alhayat.com',
  'System Administrator',
  '$2b$12$7Uasu85LNvhI8M2Jc6qwr.Nx0JqbVCWNWY2vqBH3wl6IiH3uyrcv6',
  r.id,
  true
FROM roles r WHERE r.name = 'SUPER_ADMIN'
ON CONFLICT (email) DO NOTHING;

-- ── Warehouse Manager permissions ───────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','products.write','inventory.read','inventory.adjust',
  'transfers.create','transfers.approve','transfers.dispatch','transfers.receive',
  'purchasing.write','purchasing.approve','reports.read','audit.read'
) WHERE r.name = 'WAREHOUSE_MANAGER'
ON CONFLICT DO NOTHING;

-- ── Branch Manager permissions ──────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','inventory.adjust',
  'transfers.create','transfers.receive',
  'sales.write','reports.read','branches.manage'
) WHERE r.name = 'BRANCH_MANAGER'
ON CONFLICT DO NOTHING;

-- ── Sales Staff permissions ─────────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','sales.write'
) WHERE r.name = 'SALES_STAFF'
ON CONFLICT DO NOTHING;

-- ── Inventory Staff permissions ─────────────────────
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN (
  'products.read','inventory.read','inventory.adjust',
  'transfers.create','transfers.dispatch','transfers.receive'
) WHERE r.name = 'INVENTORY_STAFF'
ON CONFLICT DO NOTHING;

-- ── Branches (30 branches across Saudi Arabia) ──────
INSERT INTO branches (name, city, address, phone) VALUES
  ('Al Hayat Riyadh Main',      'Riyadh',   'King Fahd Road, Olaya District',       '+966-11-200-0001'),
  ('Al Hayat Jeddah Corniche',  'Jeddah',   'Al Corniche Road, Al Shati District',  '+966-12-200-0002'),
  ('Al Hayat Dammam Central',   'Dammam',   'King Saud Street, Al Faisaliah',       '+966-13-200-0003'),
  ('Al Hayat Riyadh North',     'Riyadh',   'Anas Ibn Malik Road, Al Yasmeen',      '+966-11-200-0004'),
  ('Al Hayat Riyadh South',     'Riyadh',   'Al Imam Road, Al Aziziyah',            '+966-11-200-0005'),
  ('Al Hayat Makkah',           'Makkah',   'Ibrahim Al Khalil Street',             '+966-12-200-0006'),
  ('Al Hayat Madinah',          'Madinah',  'King Abdul Aziz Road',                 '+966-14-200-0007'),
  ('Al Hayat Khobar',           'Khobar',   'Prince Sultan Street',                 '+966-13-200-0008'),
  ('Al Hayat Jubail',           'Jubail',   'King Faisal East Road',                '+966-13-200-0009'),
  ('Al Hayat Tabuk',            'Tabuk',    'Prince Fahd Bin Sultan Road',           '+966-14-200-0010'),
  ('Al Hayat Abha',             'Abha',     'King Abdul Aziz Road',                 '+966-17-200-0011'),
  ('Al Hayat Hail',             'Hail',     'King Khalid Road',                     '+966-16-200-0012'),
  ('Al Hayat Buraydah',         'Buraydah', 'King Abdul Aziz Road',                 '+966-16-200-0013'),
  ('Al Hayat Najran',           'Najran',   'King Fahd Road',                       '+966-17-200-0014'),
  ('Al Hayat Jazan',            'Jazan',    'Corniche Road',                        '+966-17-200-0015'),
  ('Al Hayat Yanbu',            'Yanbu',    'King Abdul Aziz Road',                 '+966-14-200-0016'),
  ('Al Hayat Al Kharj',         'Al Kharj', 'King Fahd Road',                       '+966-11-200-0017'),
  ('Al Hayat Unaizah',          'Unaizah', 'King Abdul Aziz Road',                  '+966-16-200-0018'),
  ('Al Hayat Sakaka',           'Sakaka',   'Imam Mohammad Bin Saud Road',          '+966-14-200-0019'),
  ('Al Hayat Arar',             'Arar',     'King Fahd Road',                       '+966-14-200-0020'),
  ('Al Hayat Hofuf',            'Hofuf',    'King Faisal Road',                     '+966-13-200-0021'),
  ('Al Hayat Taif',             'Taif',     'Shubra Road',                          '+966-12-200-0022'),
  ('Al Hayat Riyadh Exit 5',    'Riyadh',   'Northern Ring Road, Exit 5',           '+966-11-200-0023'),
  ('Al Hayat Riyadh Exit 10',   'Riyadh',   'Eastern Ring Road, Exit 10',           '+966-11-200-0024'),
  ('Al Hayat Jeddah North',     'Jeddah',   'Prince Sultan Road, Al Salamah',       '+966-12-200-0025'),
  ('Al Hayat Jeddah South',     'Jeddah',   'Al Madinah Road, Al Safa',             '+966-12-200-0026'),
  ('Al Hayat Dammam North',     'Dammam',   'King Fahd Road, Al Muhammadiyah',      '+966-13-200-0027'),
  ('Al Hayat Bisha',            'Bisha',    'King Khalid Road',                     '+966-17-200-0028'),
  ('Al Hayat Qatif',            'Qatif',    'Tarut Road',                           '+966-13-200-0029'),
  ('Al Hayat Riyadh Panorama',  'Riyadh',   'Takhasusi Street, Panorama Mall',      '+966-11-200-0030')
ON CONFLICT DO NOTHING;

-- ── Warehouses ──────────────────────────────────────
INSERT INTO warehouses (name, city, address, phone) VALUES
  ('Central Warehouse',         'Riyadh',  'Second Industrial City, Block 7',  '+966-11-300-0001'),
  ('Eastern Region Warehouse',  'Dammam',  'Industrial City, Zone 3',          '+966-13-300-0002'),
  ('Western Region Warehouse',  'Jeddah',  'South Industrial Area, Plot 42',   '+966-12-300-0003')
ON CONFLICT DO NOTHING;

-- ── Categories ──────────────────────────────────────
INSERT INTO categories (name, parent_id) VALUES
  ('Living Room', NULL),
  ('Bedroom', NULL),
  ('Dining Room', NULL),
  ('Office', NULL),
  ('Outdoor', NULL)
ON CONFLICT DO NOTHING;

-- Subcategories
INSERT INTO categories (name, parent_id)
SELECT sub.name, c.id FROM (VALUES
  ('Sofas',           'Living Room'),
  ('TV Units',        'Living Room'),
  ('Coffee Tables',   'Living Room'),
  ('Armchairs',       'Living Room'),
  ('Beds',            'Bedroom'),
  ('Wardrobes',       'Bedroom'),
  ('Nightstands',     'Bedroom'),
  ('Dressers',        'Bedroom'),
  ('Dining Tables',   'Dining Room'),
  ('Dining Chairs',   'Dining Room'),
  ('Buffets',         'Dining Room'),
  ('Desks',           'Office'),
  ('Office Chairs',   'Office'),
  ('Bookshelves',     'Office'),
  ('Garden Sets',     'Outdoor'),
  ('Swing Chairs',    'Outdoor')
) AS sub(name, parent_name)
JOIN categories c ON c.name = sub.parent_name
ON CONFLICT DO NOTHING;

-- ── Brands ──────────────────────────────────────────
INSERT INTO brands (name) VALUES
  ('Al Hayat Signature'),
  ('Al Hayat Modern'),
  ('Al Hayat Classic'),
  ('Al Hayat Premium'),
  ('Al Hayat Essentials')
ON CONFLICT DO NOTHING;

-- ── Admin User (password: Admin@123456) ─────────────
-- bcrypt hash of "Admin@123456" with 10 rounds
INSERT INTO users (email, password_hash, full_name, phone, is_active) VALUES
  ('admin@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'System Administrator', '+966-11-100-0001', true),
  ('warehouse@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Ahmed Al Rashid', '+966-11-100-0002', true),
  ('branch@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Khalid Al Mohsen', '+966-12-100-0003', true),
  ('sales@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Omar Al Fahad', '+966-13-100-0004', true),
  ('inventory@alhayat.sa', '$2b$10$rICGcBmJGxs8sLkzRa8BUOaF0GZdFkL.4jQ6YFRJi2Mch1LvqZkOm', 'Saud Al Ibrahim', '+966-11-100-0005', true)
ON CONFLICT (email) DO NOTHING;

-- ── Assign roles to users ───────────────────────────
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id FROM users u JOIN roles r ON
  (u.email = 'admin@alhayat.sa'     AND r.name = 'SUPER_ADMIN') OR
  (u.email = 'warehouse@alhayat.sa' AND r.name = 'WAREHOUSE_MANAGER') OR
  (u.email = 'branch@alhayat.sa'    AND r.name = 'BRANCH_MANAGER') OR
  (u.email = 'sales@alhayat.sa'     AND r.name = 'SALES_STAFF') OR
  (u.email = 'inventory@alhayat.sa' AND r.name = 'INVENTORY_STAFF')
ON CONFLICT DO NOTHING;

-- ── Sample Products ─────────────────────────────────
INSERT INTO products (sku, name, description, category_id, brand_id, cost_price, selling_price, reorder_level) VALUES
  ('AH-SF-1001', 'Royal Chesterfield Sofa', 'Premium leather 3-seater Chesterfield with tufted back and rolled arms',
    (SELECT id FROM categories WHERE name = 'Sofas' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 2800.00, 4500.00, 5),
  ('AH-SF-1002', 'Modern L-Shape Sectional', 'Contemporary L-shaped fabric sectional with chaise lounge',
    (SELECT id FROM categories WHERE name = 'Sofas' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 3200.00, 5200.00, 3),
  ('AH-BD-2001', 'King Platform Bed - Walnut', 'Solid walnut king-size platform bed with upholstered headboard',
    (SELECT id FROM categories WHERE name = 'Beds' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 3500.00, 5800.00, 4),
  ('AH-BD-2002', 'Queen Storage Bed - Oak', 'Oak queen bed with hydraulic lift storage compartment',
    (SELECT id FROM categories WHERE name = 'Beds' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 2200.00, 3600.00, 6),
  ('AH-WR-3001', 'Six Door Wardrobe - White', 'Full-length mirrored six-door wardrobe with interior lighting',
    (SELECT id FROM categories WHERE name = 'Wardrobes' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Premium'), 4000.00, 6500.00, 3),
  ('AH-DT-4001', 'Extendable Dining Table', '8-seater extendable solid wood dining table',
    (SELECT id FROM categories WHERE name = 'Dining Tables' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 1800.00, 2900.00, 5),
  ('AH-DC-4101', 'Upholstered Dining Chair', 'Velvet upholstered dining chair with gold-finish legs',
    (SELECT id FROM categories WHERE name = 'Dining Chairs' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 450.00, 750.00, 20),
  ('AH-TV-5001', 'Floating TV Unit 240cm', 'Wall-mounted TV unit with LED backlighting and cable management',
    (SELECT id FROM categories WHERE name = 'TV Units' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 1200.00, 1950.00, 8),
  ('AH-CT-5101', 'Marble Top Coffee Table', 'Italian marble top with brass-finish steel frame',
    (SELECT id FROM categories WHERE name = 'Coffee Tables' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Signature'), 900.00, 1500.00, 10),
  ('AH-DK-6001', 'Executive Office Desk', 'L-shaped executive desk with cable management and drawers',
    (SELECT id FROM categories WHERE name = 'Desks' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Premium'), 2100.00, 3400.00, 4),
  ('AH-NS-2101', 'Bedside Table - Walnut', 'Two-drawer walnut nightstand with soft-close drawers',
    (SELECT id FROM categories WHERE name = 'Nightstands' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Classic'), 350.00, 580.00, 15),
  ('AH-BF-4201', 'Modern Buffet Cabinet', 'Scandinavian-style buffet with sliding doors',
    (SELECT id FROM categories WHERE name = 'Buffets' LIMIT 1), (SELECT id FROM brands WHERE name = 'Al Hayat Modern'), 1500.00, 2400.00, 5)
ON CONFLICT (sku) DO NOTHING;

-- ── Product Variants (with barcodes for scanning) ───
INSERT INTO product_variants (product_id, sku, barcode, color, material, dimensions) VALUES
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-BRN', '6281000010011', 'Brown', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-BLK', '6281000010012', 'Black', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1001'), 'AH-SF-1001-TAN', '6281000010013', 'Tan', 'Full Grain Leather', '220x90x85 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1002'), 'AH-SF-1002-GRY', '6281000010021', 'Grey', 'Premium Fabric', '300x180x90 cm'),
  ((SELECT id FROM products WHERE sku='AH-SF-1002'), 'AH-SF-1002-NVY', '6281000010022', 'Navy', 'Premium Fabric', '300x180x90 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2001'), 'AH-BD-2001-WAL', '6281000020011', 'Walnut', 'Solid Wood', '210x190x120 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2001'), 'AH-BD-2001-CHR', '6281000020012', 'Cherry', 'Solid Wood', '210x190x120 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2002'), 'AH-BD-2002-OAK', '6281000020021', 'Natural Oak', 'Solid Oak', '200x170x100 cm'),
  ((SELECT id FROM products WHERE sku='AH-BD-2002'), 'AH-BD-2002-WOK', '6281000020022', 'White Oak', 'Solid Oak', '200x170x100 cm'),
  ((SELECT id FROM products WHERE sku='AH-WR-3001'), 'AH-WR-3001-WHT', '6281000030011', 'White', 'MDF with Lacquer', '300x60x240 cm'),
  ((SELECT id FROM products WHERE sku='AH-WR-3001'), 'AH-WR-3001-GRY', '6281000030012', 'Grey', 'MDF with Lacquer', '300x60x240 cm'),
  ((SELECT id FROM products WHERE sku='AH-DT-4001'), 'AH-DT-4001-WNT', '6281000040011', 'Walnut', 'Solid Wood', '200x100x76 cm (extends to 260cm)'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-GRN', '6281000041011', 'Emerald Green', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-NVY', '6281000041012', 'Navy', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-DC-4101'), 'AH-DC-4101-BLH', '6281000041013', 'Blush', 'Velvet', '48x55x92 cm'),
  ((SELECT id FROM products WHERE sku='AH-TV-5001'), 'AH-TV-5001-WHT', '6281000050011', 'White', 'MDF with Lacquer', '240x40x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-TV-5001'), 'AH-TV-5001-WAL', '6281000050012', 'Walnut', 'Veneer', '240x40x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-CT-5101'), 'AH-CT-5101-WHT', '6281000051011', 'White Marble', 'Italian Marble + Brass', '120x60x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-CT-5101'), 'AH-CT-5101-BLK', '6281000051012', 'Black Marble', 'Italian Marble + Brass', '120x60x45 cm'),
  ((SELECT id FROM products WHERE sku='AH-DK-6001'), 'AH-DK-6001-WAL', '6281000060011', 'Walnut', 'Solid Wood + Steel', '180x150x75 cm'),
  ((SELECT id FROM products WHERE sku='AH-NS-2101'), 'AH-NS-2101-WAL', '6281000021011', 'Walnut', 'Solid Wood', '50x40x55 cm'),
  ((SELECT id FROM products WHERE sku='AH-NS-2101'), 'AH-NS-2101-OAK', '6281000021012', 'Oak', 'Solid Wood', '50x40x55 cm'),
  ((SELECT id FROM products WHERE sku='AH-BF-4201'), 'AH-BF-4201-WHT', '6281000042011', 'White', 'MDF with Lacquer', '160x45x80 cm'),
  ((SELECT id FROM products WHERE sku='AH-BF-4201'), 'AH-BF-4201-OAK', '6281000042012', 'Natural Oak', 'Oak Veneer', '160x45x80 cm')
ON CONFLICT (sku) DO NOTHING;

-- ── Warehouse Locations (bins) ──────────────────────
INSERT INTO warehouse_locations (warehouse_id, aisle, rack, shelf, bin, barcode)
SELECT w.id, loc.aisle, loc.rack, loc.shelf, loc.bin, loc.barcode
FROM warehouses w
CROSS JOIN (VALUES
  ('A', '01', '1', '01', 'CW-A-01-1-01'),
  ('A', '01', '1', '02', 'CW-A-01-1-02'),
  ('A', '01', '2', '01', 'CW-A-01-2-01'),
  ('A', '01', '2', '02', 'CW-A-01-2-02'),
  ('A', '02', '1', '01', 'CW-A-02-1-01'),
  ('A', '02', '1', '02', 'CW-A-02-1-02'),
  ('A', '02', '2', '01', 'CW-A-02-2-01'),
  ('B', '01', '1', '01', 'CW-B-01-1-01'),
  ('B', '01', '1', '02', 'CW-B-01-1-02'),
  ('B', '01', '2', '01', 'CW-B-01-2-01'),
  ('B', '02', '1', '01', 'CW-B-02-1-01'),
  ('B', '02', '1', '02', 'CW-B-02-1-02'),
  ('C', '01', '1', '01', 'CW-C-01-1-01'),
  ('C', '01', '1', '02', 'CW-C-01-1-02'),
  ('C', '02', '1', '01', 'CW-C-02-1-01'),
  ('D', '01', '1', '01', 'CW-D-01-1-01'),
  ('D', '01', '1', '02', 'CW-D-01-1-02'),
  ('D', '01', '2', '01', 'CW-D-01-2-01'),
  ('D', '01', '2', '02', 'CW-D-01-2-02'),
  ('D', '02', '1', '01', 'CW-D-02-1-01')
) AS loc(aisle, rack, shelf, bin, barcode)
WHERE w.name = 'Central Warehouse'
ON CONFLICT DO NOTHING;

-- ── Suppliers ───────────────────────────────────────
INSERT INTO suppliers (name, contact_name, email, phone, address) VALUES
  ('Royal Furniture Factory',    'Mohammed Al Otaibi',  'sales@royalfurniture.sa',  '+966-11-400-0001', 'Second Industrial City, Riyadh'),
  ('Al Madinah Wood Works',      'Abdullah Al Harbi',   'info@madinahwood.sa',      '+966-14-400-0002', 'Industrial Zone, Madinah'),
  ('Italian Imports Trading',    'Giuseppe Romano',     'gulf@italimports.com',     '+966-12-400-0003', 'Jeddah Islamic Port, Free Zone'),
  ('Eastern Upholstery Co.',     'Nasser Al Dosari',    'orders@easternupholstery.sa', '+966-13-400-0004', 'Dammam Industrial, Zone 7'),
  ('Turkish Home Collection',    'Mehmet Yilmaz',       'export@turkhome.com.tr',   '+966-12-400-0005', 'Jeddah, Al Khumra')
ON CONFLICT DO NOTHING;

-- ── Customers ───────────────────────────────────────
INSERT INTO customers (name, email, phone, address) VALUES
  ('Interior Designs Studio',    'projects@interiordesigns.sa',  '+966-11-500-0001', 'Riyadh, Al Olaya'),
  ('Royal Villa Development',    'procurement@royalvilla.sa',    '+966-11-500-0002', 'Riyadh, Al Nakheel'),
  ('Al Faisal Hotels Group',     'purchasing@alfaisal.sa',       '+966-12-500-0003', 'Jeddah, Corniche Road'),
  ('Corporate Office Solutions', 'info@corpoffice.sa',           '+966-13-500-0004', 'Khobar, Business District'),
  ('Walk-in Customer',            NULL,                           NULL,               NULL)
ON CONFLICT DO NOTHING;

-- ── Sample Inventory Stock (Central Warehouse) ──────
INSERT INTO inventory_stock (variant_id, owner_type, warehouse_id, warehouse_location_id, quantity_on_hand, quantity_reserved)
SELECT
  v.id,
  'WAREHOUSE',
  w.id,
  (SELECT wl.id FROM warehouse_locations wl WHERE wl.warehouse_id = w.id ORDER BY random() LIMIT 1),
  floor(random() * 40 + 5)::int,
  floor(random() * 5)::int
FROM product_variants v
CROSS JOIN warehouses w
WHERE w.name = 'Central Warehouse'
ON CONFLICT DO NOTHING;

-- ── Sample Inventory Stock (Branch stock for first 5 branches) ──
INSERT INTO inventory_stock (variant_id, owner_type, branch_id, quantity_on_hand, quantity_reserved)
SELECT
  v.id,
  'BRANCH',
  b.id,
  floor(random() * 10 + 1)::int,
  floor(random() * 2)::int
FROM product_variants v
CROSS JOIN (SELECT id FROM branches ORDER BY name LIMIT 5) b
ON CONFLICT DO NOTHING;
