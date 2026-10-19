-- Al Hayat ERP — read-only reconciliation queries (audit 2026-10-19)
-- Every statement is a SELECT. Run them in Railway's Postgres query console
-- (or psql) and keep the output; nothing here modifies data.
-- Validated against PostgreSQL 17 test databases built by backend/tests.
-- See docs/audit/ACCOUNTING_RECONCILIATION.md for how to read each result.

-- R1. Journal entries whose debits and credits do not balance (expected: no rows)
SELECT je.id, je.entry_number, je.reference_type, je.reference_id, je.status,
       ROUND(SUM(jel.debit_amount)::numeric, 2)  AS debits,
       ROUND(SUM(jel.credit_amount)::numeric, 2) AS credits
FROM journal_entries je
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
GROUP BY je.id
HAVING ABS(SUM(jel.debit_amount) - SUM(jel.credit_amount)) > 0.005;

-- R2. Journal entry headers without lines (expected: no rows)
SELECT je.id, je.entry_number, je.status, je.description, je.created_at
FROM journal_entries je
WHERE NOT EXISTS (SELECT 1 FROM journal_entry_lines jel WHERE jel.journal_entry_id = je.id);

-- R3. Customer cash in the ledger vs. payments recorded on each invoice.
--     A positive difference is cash posted more than once (finding ACC-01:
--     the accounting dashboard re-posted payments made through the payment
--     screens). A negative difference is a payment missing from the ledger
--     (ACC-05/ACC-10). Cancelled invoices are excluded.
WITH recorded AS (
  SELECT i.id AS invoice_id, i.invoice_number, i.sales_order_id,
         COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0) AS recorded_payments
  FROM invoices i
  WHERE i.status != 'CANCELLED'
),
ledger AS (
  SELECT r.invoice_id, COALESCE(SUM(jel.debit_amount), 0) AS ledger_cash
  FROM recorded r
  JOIN journal_entries je
    ON je.reference_type = 'SALE' AND je.status IN ('POSTED', 'REVERSED')
   AND (je.reference_id = r.invoice_id
        OR je.reference_id = r.sales_order_id || '-pay'
        OR je.reference_id IN (SELECT ip.id FROM invoice_payments ip WHERE ip.invoice_id = r.invoice_id)
        OR je.reference_id IN (SELECT cp.id FROM customer_payments cp WHERE cp.invoice_id = r.invoice_id))
  JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '1010'
  GROUP BY r.invoice_id
)
SELECT r.invoice_number, r.sales_order_id,
       ROUND(r.recorded_payments::numeric, 2)                                AS recorded_payments,
       ROUND(COALESCE(l.ledger_cash, 0)::numeric, 2)                         AS ledger_cash,
       ROUND((COALESCE(l.ledger_cash, 0) - r.recorded_payments)::numeric, 2) AS difference
FROM recorded r
LEFT JOIN ledger l ON l.invoice_id = r.invoice_id
WHERE ABS(COALESCE(l.ledger_cash, 0) - r.recorded_payments) > 0.01
ORDER BY difference DESC;

-- R4. Payment journals posted by the dashboard backfill (ACC-01 suspects):
--     a "Customer Payment Received" entry keyed to the invoice id on an
--     invoice whose payments were also journaled under their own payment ids.
SELECT je.entry_number, je.entry_date, je.created_at, je.reference_id AS invoice_id, je.total_debit AS amount
FROM journal_entries je
JOIN invoices i ON i.id = je.reference_id
WHERE je.reference_type = 'SALE'
  AND je.description LIKE 'Customer Payment Received for Order #%'
  AND EXISTS (
    SELECT 1 FROM journal_entries pj
    WHERE pj.reference_type = 'SALE' AND pj.id != je.id
      AND (pj.reference_id IN (SELECT ip.id FROM invoice_payments ip WHERE ip.invoice_id = i.id)
           OR pj.reference_id IN (SELECT cp.id FROM customer_payments cp WHERE cp.invoice_id = i.id))
  )
ORDER BY je.created_at;

-- R5. Sales journals whose receivable excludes the installation fee (ACC-04)
SELECT so.order_number, i.invoice_number, so.installation_fee,
       ROUND((i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0))::numeric, 2) AS invoice_due,
       ROUND(SUM(jel.debit_amount)::numeric, 2) AS receivable_posted
FROM sales_orders so
JOIN invoices i ON i.sales_order_id = so.id AND i.status != 'CANCELLED'
JOIN journal_entries je ON je.reference_type = 'SALE' AND je.reference_id = so.id AND je.status IN ('POSTED', 'REVERSED')
JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '1020'
WHERE COALESCE(so.installation_fee, 0) > 0
GROUP BY so.id, i.id
HAVING ABS(SUM(jel.debit_amount) - (i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0))) > 0.01;

-- R6. Accounts receivable: ledger (1020) vs. operational customer balances
SELECT
  (SELECT ROUND(COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::numeric, 2)
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED')
     JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '1020') AS ledger_receivable,
  (SELECT ROUND(COALESCE(SUM(GREATEST(0, i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0)
                 - COALESCE((SELECT SUM(ip.amount) FROM invoice_payments ip WHERE ip.invoice_id = i.id), 0))), 0)::numeric, 2)
     FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id
     WHERE i.status != 'CANCELLED' AND so.status != 'CANCELLED') AS unpaid_invoices,
  (SELECT ROUND(COALESCE(SUM(remaining_balance), 0)::numeric, 2) FROM customer_debts WHERE status != 'CANCELLED') AS unpaid_manual_charges,
  (SELECT ROUND(COALESCE(SUM(amount), 0)::numeric, 2) FROM customer_payments WHERE allocation_type = 'ACCOUNT') AS unallocated_payments;

-- R7. Inventory: ledger (1030) vs. on-hand stock valued at product cost
SELECT
  (SELECT ROUND(COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::numeric, 2)
     FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED')
     JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '1030') AS ledger_inventory,
  (SELECT ROUND(COALESCE(SUM(s.quantity_on_hand * p.cost_price), 0)::numeric, 2)
     FROM inventory_stock s JOIN products p ON p.id = s.product_id) AS stock_at_cost;

-- R8. Stock balances not explained by the movement ledger (opening stock set
--     at product creation/import has no movement row — ACC-18 — so a
--     difference equal to the opening quantity is expected for those).
WITH moves AS (
  SELECT product_id,
         COALESCE(destination_owner_type, dest_owner_type, source_owner_type) AS owner_type,
         CASE WHEN quantity > 0 THEN COALESCE(destination_warehouse_id, dest_warehouse_id) ELSE source_warehouse_id END AS warehouse_id,
         CASE WHEN quantity > 0 THEN COALESCE(destination_branch_id, dest_branch_id) ELSE source_branch_id END AS branch_id,
         quantity
  FROM inventory_transactions
)
SELECT p.sku, p.name, s.owner_type, s.warehouse_id, s.branch_id, s.quantity_on_hand,
       COALESCE((SELECT SUM(m.quantity) FROM moves m
                 WHERE m.product_id = s.product_id
                   AND m.warehouse_id IS NOT DISTINCT FROM s.warehouse_id
                   AND m.branch_id IS NOT DISTINCT FROM s.branch_id), 0) AS movement_total
FROM inventory_stock s
JOIN products p ON p.id = s.product_id
WHERE s.quantity_on_hand != COALESCE((SELECT SUM(m.quantity) FROM moves m
                 WHERE m.product_id = s.product_id
                   AND m.warehouse_id IS NOT DISTINCT FROM s.warehouse_id
                   AND m.branch_id IS NOT DISTINCT FROM s.branch_id), 0)
ORDER BY p.sku;

-- R9. Negative stock and duplicate stock rows for the same product/location (INV-09)
SELECT 'negative' AS issue, product_id, owner_type, warehouse_id, branch_id, quantity_on_hand, 1 AS row_count
FROM inventory_stock WHERE quantity_on_hand < 0
UNION ALL
SELECT 'duplicate rows', product_id, owner_type, warehouse_id, branch_id, SUM(quantity_on_hand), COUNT(*)
FROM inventory_stock
GROUP BY product_id, owner_type, warehouse_id, branch_id, warehouse_location_id
HAVING COUNT(*) > 1;

-- R10. Manual reversals that the old reports mis-stated (ACC-02): originals
--      flagged REVERSED were dropped from reports while their reversals counted.
SELECT je.entry_number, je.entry_date, je.description, je.total_debit
FROM journal_entries je WHERE je.status = 'REVERSED' ORDER BY je.entry_date;

-- R11. Completed work orders without a finished-goods journal (ACC-08) and the WIP balance
SELECT wo.wo_number, wo.completed_at, wo.material_cost
FROM work_orders wo
WHERE wo.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM journal_entries je
                  WHERE je.reference_type = 'MANUFACTURING' AND je.reference_id = wo.id || ':complete');
SELECT ROUND(COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)::numeric, 2) AS wip_balance_1070
FROM journal_entry_lines jel
JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status IN ('POSTED', 'REVERSED')
JOIN chart_of_accounts coa ON coa.id = jel.account_id AND coa.code = '1070';

-- R12. Expenses vs. ledger (ACC-06): expenses whose posted amount differs, and
--      expense journals whose expense was deleted
SELECT e.id, e.title, e.amount, e.expense_date,
       (SELECT ROUND(SUM(je.total_debit)::numeric, 2) FROM journal_entries je
         WHERE je.reference_type = 'EXPENSE' AND je.reference_id = e.id AND je.status = 'POSTED') AS posted
FROM expenses e
WHERE ABS(COALESCE((SELECT SUM(je.total_debit) FROM journal_entries je
                    WHERE je.reference_type = 'EXPENSE' AND je.reference_id = e.id AND je.status = 'POSTED'), 0) - e.amount) > 0.01;
SELECT je.entry_number, je.entry_date, je.description, je.total_debit
FROM journal_entries je
WHERE je.reference_type = 'EXPENSE' AND je.status = 'POSTED'
  AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.id = je.reference_id);

-- R13. Payments larger than what they settle (ACC-10 / ACC-14)
SELECT 'customer invoice' AS kind, i.invoice_number AS document,
       ROUND((i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0))::numeric, 2) AS due,
       ROUND(SUM(ip.amount)::numeric, 2) AS paid
FROM invoices i JOIN sales_orders so ON so.id = i.sales_order_id JOIN invoice_payments ip ON ip.invoice_id = i.id
GROUP BY i.id, so.installation_fee
HAVING SUM(ip.amount) > i.total_amount - COALESCE(i.discount_amount, 0) + COALESCE(so.installation_fee, 0) + 0.01
UNION ALL
SELECT 'supplier invoice', pi.invoice_number,
       ROUND((pi.total_amount - COALESCE(pi.discount_amount, 0))::numeric, 2),
       ROUND(SUM(pip.amount)::numeric, 2)
FROM purchase_invoices pi JOIN purchase_invoice_payments pip ON pip.purchase_invoice_id = pi.id
GROUP BY pi.id
HAVING SUM(pip.amount) > pi.total_amount - COALESCE(pi.discount_amount, 0) + 0.01;

-- R14. Purchase orders received beyond the ordered quantity (INV-06)
SELECT po.po_number, p.sku, pol.quantity AS ordered, pol.quantity_received AS received
FROM purchase_order_lines pol
JOIN purchase_orders po ON po.id = pol.purchase_order_id
JOIN products p ON p.id = pol.product_id
WHERE COALESCE(pol.quantity_received, 0) > pol.quantity;

-- R15. Cancelled orders whose stock was restored more than it was issued (INV-01/02/03)
SELECT so.order_number,
       COALESCE((SELECT -SUM(it.quantity) FROM inventory_transactions it
                 JOIN invoices i ON i.id = it.reference_id AND i.sales_order_id = so.id
                 WHERE it.transaction_type = 'SALE_ISSUE'), 0) AS issued,
       COALESCE((SELECT SUM(it.quantity) FROM inventory_transactions it
                 WHERE it.transaction_type = 'SALE_CANCEL_RESTORE' AND it.reference_id = so.id), 0) AS restored
FROM sales_orders so
WHERE so.status = 'CANCELLED'
  AND COALESCE((SELECT SUM(it.quantity) FROM inventory_transactions it
                WHERE it.transaction_type = 'SALE_CANCEL_RESTORE' AND it.reference_id = so.id), 0)
      != COALESCE((SELECT -SUM(it.quantity) FROM inventory_transactions it
                   JOIN invoices i ON i.id = it.reference_id AND i.sales_order_id = so.id
                   WHERE it.transaction_type = 'SALE_ISSUE'), 0);

-- R16. Users with no branch: the API treats them as all-branch (admin-scoped) (SEC-06)
SELECT u.email, u.full_name, u.is_active,
       (SELECT STRING_AGG(r.code, ',') FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
FROM users u WHERE u.branch_id IS NULL ORDER BY u.is_active DESC, u.email;
