// The documents the company hands out, all in the one look of documentPdf.ts.
// Each builder takes what the API already returns for that document.
import { COMPANY_NAME, dateOnly, dateTime, downloadDocument, money, safeName, type DocumentSpec } from './documentPdf';

const statusWord = (s: string | null | undefined) =>
  s === 'PAID' ? 'Paid' : s === 'PARTIALLY_PAID' ? 'Partially paid' : s ? s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Unpaid';

const method = (m: string | null | undefined) => (m || 'CASH').replace(/_/g, ' ').toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** Sales invoice: data from GET /sales/invoices/:id/print. */
export function downloadSalesInvoice(data: any) {
  const inv = data.invoice, cust = data.customer || {}, br = data.branch || {};
  const net = Number(inv.net_total ?? (Number(inv.total_amount) - Number(inv.discount_amount || 0)));
  const balance = Number(inv.balance || 0);
  const spec: DocumentSpec = {
    title: 'INVOICE',
    numberLine: `Invoice # ${inv.invoice_number}`,
    issuer: [br.name, br.address, br.city, br.phone ? `Tel: ${br.phone}` : null],
    left: [
      ['Invoice Date', dateOnly(inv.issued_at)],
      ['Invoice Number', inv.invoice_number],
      ['Order Number', inv.order_number],
      ['Sold By', inv.sold_by],
      ['Customer', cust.name],
      ['Phone', cust.phone],
      ['Address', cust.address],
    ],
    right: [
      ['Status', statusWord(inv.payment_status)],
      ['Invoice Total', money(net)],
      ['Amount Paid', money(inv.amount_paid)],
      ['Balance Due', money(balance)],
      ...(inv.paid_at ? [['Paid On', dateOnly(inv.paid_at)] as [string, string]] : []),
    ],
    table: {
      head: ['PRODUCT', 'SKU', 'QTY', 'UNIT PRICE', 'DISCOUNT', 'SUB TOTAL'],
      rows: (data.lines || []).map((l: any) => {
        const disc = Number(l.discount_amount || 0);
        return [l.product_name, l.product_sku || '', String(l.quantity), money(l.unit_price),
          disc > 0.004 ? `-${money(disc)}` : money(0), money(Number(l.subtotal) - disc)];
      }),
      align: ['left', 'left', 'center', 'right', 'right', 'right'],
      widths: [0, 28, 12, 25, 24, 27],
    },
    totals: [
      { label: 'Before Discount', value: money(inv.total_amount ?? net) },
      ...(Number(inv.discount_amount) > 0 ? [{ label: 'Discount', value: `-${money(inv.discount_amount)}` }] : []),
      { label: 'TOTAL', value: money(net), strong: true },
      { label: 'Amount Paid', value: money(inv.amount_paid) },
      { label: 'Balance Due', value: money(balance), strong: balance > 0 },
    ],
    fileName: `Invoice-${safeName(inv.invoice_number)}`,
  };
  return downloadDocument(spec);
}

/** Purchase invoice: data from GET /purchasing/orders/:id/print-invoice. */
export function downloadPurchaseInvoice(data: any) {
  const inv = data.invoice, sup = data.supplier || {}, wh = data.warehouse || {}, po = data.po || {};
  const lines: any[] = data.lines || [];
  const subtotal = lines.reduce((a, l) => a + Number(l.quantity_ordered) * Number(l.unit_cost), 0);
  const discount = lines.reduce((a, l) => a + Number(l.discount_amount || 0), 0);
  const total = Number(inv.net_total ?? inv.total_amount);
  const balance = Number(inv.balance || 0);
  return downloadDocument({
    title: 'PURCHASE INVOICE',
    numberLine: `Invoice # ${inv.invoice_number}`,
    issuer: [wh.name ? `Received at ${wh.name}` : null, wh.address],
    left: [
      ['Invoice Date', dateOnly(inv.issued_at)],
      ['Invoice Number', inv.invoice_number],
      ['PO Number', po.po_number],
      ['Supplier', sup.name],
      ['Contact', sup.contactName],
      ['Phone', sup.phone],
      ['Address', sup.address],
    ],
    right: [
      ['Status', statusWord(inv.payment_status || inv.status)],
      ['Invoice Total', money(total)],
      ['Paid to Supplier', money(inv.amount_paid)],
      ['Remaining Payable', money(balance)],
    ],
    table: {
      head: ['PRODUCT', 'SKU', 'QTY', 'UNIT COST', 'DISCOUNT', 'SUB TOTAL'],
      rows: lines.map((l) => [
        l.product_name, l.variant_sku || '', String(l.quantity_ordered), money(l.unit_cost),
        Number(l.discount_amount) > 0 ? `-${money(l.discount_amount)}` : money(0),
        money(l.line_total ?? (Number(l.quantity_ordered) * Number(l.unit_cost) - Number(l.discount_amount || 0))),
      ]),
      align: ['left', 'left', 'center', 'right', 'right', 'right'],
      widths: [0, 30, 13, 24, 22, 26],
    },
    totals: [
      { label: 'Subtotal', value: money(subtotal) },
      ...(discount > 0 ? [{ label: 'Discount', value: `-${money(discount)}` }] : []),
      { label: 'TOTAL', value: money(total), strong: true },
      { label: 'Paid to Supplier', value: money(inv.amount_paid) },
      { label: 'Remaining Payable', value: money(balance), strong: balance > 0 },
    ],
    footer: `Purchase invoice for goods received into stock. ${COMPANY_NAME}`,
    fileName: `Purchase-Invoice-${safeName(inv.invoice_number)}`,
    noTerms: true,
  });
}

/**
 * Customer payment receipt: the receipt returned by POST /sales/payments, or the payment
 * from GET /sales/payments/:receiptNumber/receipt.
 */
export function downloadPaymentReceipt(r: any) {
  const what = r.allocation_type === 'INVOICE'
    ? `Payment for invoice${r.bill_number ? ` ${r.bill_number}` : ''}`
    : r.allocation_type === 'MANUAL_DEBT'
      ? `Payment for service charge${r.bill_number ? ` ${r.bill_number}` : ''}`
      : 'Payment to customer account';
  return downloadDocument({
    title: 'RECEIPT',
    numberLine: `Receipt # ${r.receipt_number}`,
    issuer: [],
    left: [
      ['Payment Date', dateTime(r.payment_date || r.created_at)],
      ['Receipt Number', r.receipt_number],
      ['Customer', r.customer_name],
      ['Phone', r.customer_phone],
      ['Address', r.customer_address],
    ],
    right: [
      ['Payment Method', method(r.payment_method)],
      ...(r.money_account_name ? [['Received Into', r.money_account_name] as [string, string]] : []),
      ['Amount Paid', money(r.amount)],
      ['Previous Balance', money(r.previous_balance)],
      ['Remaining Balance', money(r.remaining_balance)],
    ],
    table: {
      head: ['TYPE', 'DESCRIPTION', 'METHOD', 'AMOUNT'],
      rows: [['PAYMENT', what, method(r.payment_method), money(r.amount)]],
      align: ['left', 'left', 'left', 'right'],
      widths: [26, 0, 32, 30],
    },
    totals: [{ label: 'TOTAL PAID', value: money(r.amount), strong: true }],
    extra: (r.recorded_by_name || r.notes)
      ? { title: 'Additional Details:', rows: [['Recorded By', r.recorded_by_name], ['Notes', r.notes]].filter(([, v]) => v) as [string, string][] }
      : undefined,
    footer: `Thank you for your payment. ${COMPANY_NAME}`,
    fileName: `Receipt-${safeName(r.receipt_number)}`,
  });
}

/** Customer statement of account: data from GET /sales/customers/:id/ledger. */
export function downloadStatement(ledger: any) {
  const c = ledger.customer || {};
  const balance = Number(ledger.current_balance ?? c.current_balance ?? 0);
  const entries: any[] = ledger.entries || ledger.ledger || [];
  return downloadDocument({
    title: 'STATEMENT',
    numberLine: `Statement of Account · ${c.name}`,
    issuer: [],
    left: [
      ['Customer', c.name],
      ['Phone', c.phone],
      ['Email', c.email],
      ['Address', c.address],
    ],
    right: [
      ['Statement Date', dateOnly(new Date())],
      ['Balance Due', money(balance)],
    ],
    table: {
      head: ['DATE', 'REFERENCE', 'DESCRIPTION', 'CHARGE', 'PAYMENT', 'BALANCE'],
      rows: entries.map((e) => {
        const dr = Number(e.debit ?? e.charge ?? 0), cr = Number(e.credit ?? e.payment ?? 0);
        return [dateOnly(e.date), e.reference || '', e.description || '', dr > 0 ? money(dr) : '—', cr > 0 ? money(cr) : '—', money(e.running_balance)];
      }),
      align: ['left', 'left', 'left', 'right', 'right', 'right'],
      widths: [22, 30, 0, 22, 22, 24],
    },
    totals: [{ label: 'BALANCE DUE', value: money(balance), strong: true }],
    fileName: `Statement-${safeName(c.name || 'customer')}-${new Date().toISOString().slice(0, 10)}`,
  });
}

/** Supplier payment voucher: one payment from the purchase invoice's payment history. */
export function downloadSupplierPayment(p: any, po: any, invoiceNumber: string) {
  const number = `PV-${String(p.id).slice(0, 8).toUpperCase()}`;
  return downloadDocument({
    title: 'PAYMENT VOUCHER',
    numberLine: `Voucher # ${number}`,
    issuer: [po?.branch_name || po?.warehouse_name],
    left: [
      ['Payment Date', dateTime(p.payment_date || p.created_at)],
      ['Voucher Number', number],
      ['Paid To', po?.supplier_name],
      ['Supplier Phone', po?.supplier_phone],
      ['Purchase Order', po?.po_number],
      ['Supplier Invoice', invoiceNumber],
    ],
    right: [
      ['Paid From', p.money_account_name || method(p.payment_method)],
      ['Amount Paid', money(p.amount)],
      ['Balance After', money(p.running_balance)],
    ],
    table: {
      head: ['TYPE', 'DESCRIPTION', 'PAID FROM', 'AMOUNT'],
      rows: [['PAYMENT', `Payment for invoice ${invoiceNumber}`, p.money_account_name || method(p.payment_method), money(p.amount)]],
      align: ['left', 'left', 'left', 'right'],
      widths: [26, 0, 36, 30],
    },
    totals: [{ label: 'TOTAL PAID', value: money(p.amount), strong: true }],
    extra: (p.recorded_by_name || p.notes)
      ? { title: 'Additional Details:', rows: [['Paid By', p.recorded_by_name], ['Notes', p.notes]].filter(([, v]) => v) as [string, string][] }
      : undefined,
    footer: `Payment to supplier. ${COMPANY_NAME}`,
    fileName: `Payment-Voucher-${safeName(number)}`,
    noTerms: true,
  });
}

/** Expense voucher: one expense as listed in Expenses. */
export function downloadExpenseVoucher(e: any) {
  const number = e.reference ? String(e.reference) : `EXP-${String(e.id).slice(0, 8).toUpperCase()}`;
  const owed = ['CREDIT', 'ON_ACCOUNT', 'UNPAID', 'PAYABLE'].includes(String(e.payment_method || '').toUpperCase());
  const account = e.expense_account_code ? `${e.expense_account_code} ${e.expense_account_name || ''}`.trim() : e.category;
  return downloadDocument({
    title: 'EXPENSE VOUCHER',
    numberLine: `Voucher # ${number}`,
    issuer: [e.branch_name],
    left: [
      ['Expense Date', dateOnly(e.expense_date)],
      ['Voucher Number', number],
      ['Description', e.title],
      ['Category', e.category],
      ['Expense Account', account],
      ...(e.class_name ? [['Class', e.class_name] as [string, string]] : []),
    ],
    right: [
      ['Status', owed ? 'Not paid yet' : 'Paid'],
      ['Paid From', owed ? 'Owed (Accounts Payable)' : (e.money_account_name || method(e.payment_method))],
      ...(e.paid_at && !owed ? [['Paid On', dateOnly(e.paid_at)] as [string, string]] : []),
      ['Amount', money(e.amount)],
    ],
    table: {
      head: ['ACCOUNT', 'DESCRIPTION', 'AMOUNT'],
      rows: [[account || '', e.title || '', money(e.amount)]],
      align: ['left', 'left', 'right'],
      widths: [50, 0, 30],
    },
    totals: [{ label: 'TOTAL', value: money(e.amount), strong: true }],
    extra: (e.recorded_by_name || e.notes)
      ? { title: 'Additional Details:', rows: [['Recorded By', e.recorded_by_name], ['Notes', e.notes]].filter(([, v]) => v) as [string, string][] }
      : undefined,
    footer: `Expense voucher. ${COMPANY_NAME}`,
    fileName: `Expense-${safeName(number)}`,
    noTerms: true,
  });
}

/** Payslip: one employee's line of a payroll run. */
export function downloadPayslip(run: any, l: any) {
  const monthName = new Date(`${run.period}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const number = `PS-${run.period}-${String(l.employee_id || l.id).slice(0, 6).toUpperCase()}`;
  const rows: string[][] = [['Basic salary', money(l.basic)]];
  if (l.attendance_deduction > 0) rows.push([`Absent days (${l.absent_days})`, `-${money(l.attendance_deduction)}`]);
  if (l.commission > 0) rows.push(['Sales commission', money(l.commission)]);
  if (l.additions > 0) rows.push(['Bonus / additions', money(l.additions)]);
  if (l.other_deductions > 0) rows.push(['Other deductions', `-${money(l.other_deductions)}`]);
  if (l.advance_deduction > 0) rows.push(['Salary advance repaid', `-${money(l.advance_deduction)}`]);
  return downloadDocument({
    title: 'PAYSLIP',
    numberLine: `Payslip # ${number}`,
    issuer: [l.branch_name],
    left: [
      ['Employee', l.full_name],
      ['Position', l.position],
      ['Branch', l.branch_name || 'Company'],
      ['Pay Period', monthName],
    ],
    right: [
      ['Status', l.status === 'PAID' ? 'Paid' : run.status === 'DRAFT' ? 'Draft (not approved)' : 'Approved, not paid yet'],
      ...(l.paid_at ? [['Paid On', dateOnly(l.paid_at)] as [string, string]] : []),
      ['Net Pay', money(l.net)],
    ],
    table: { head: ['ITEM', 'AMOUNT'], rows, align: ['left', 'right'], widths: [0, 40] },
    totals: [{ label: 'NET PAY', value: money(l.net), strong: true }],
    extra: l.notes ? { title: 'Commission Details:', rows: [['', l.notes]] } : undefined,
    footer: `Payslip for ${monthName}. ${COMPANY_NAME}`,
    fileName: `Payslip-${safeName(l.full_name || 'employee')}-${run.period}`,
    noTerms: true,
  });
}
