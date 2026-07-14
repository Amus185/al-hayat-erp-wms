SELECT p.id, p.name, p.cost_price, p.selling_price, 
       (SELECT SUM(quantity) FROM invoice_lines WHERE product_id = p.id) as sold_qty
FROM products p;
