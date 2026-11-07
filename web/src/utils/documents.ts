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
