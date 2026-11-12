// Settings → Documents: how invoices, receipts, quotations and statements look (Owner only),
// with a live preview of a sample invoice.
import { useEffect, useRef, useState } from 'react';
import { apiPut } from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { DEFAULT_LAYOUT, documentLayout, forgetDocumentLayout, previewDocument, money, type DocumentLayout, type DocumentSpec } from '../utils/documentPdf';

const SAMPLE: DocumentSpec = {
  title: 'INVOICE', numberLine: 'Invoice # INV-SAMPLE-001',
  issuer: ['Al Hayat HQ Showroom', '26 June Road', 'Hargeisa', 'Tel: +252 63 4000000'],
  left: [['Invoice Date', '12 Nov 2026'], ['Invoice Number', 'INV-SAMPLE-001'], ['Sold By', 'Hodan Ali'], ['Customer', 'Abdirahman Yusuf'], ['Phone', '063 4111111']],
  right: [['Status', 'Partly paid'], ['Invoice Total', money(1180)], ['Amount Paid', money(500)], ['Balance Due', money(680)]],
  table: {
    head: ['PRODUCT', 'SKU', 'QTY', 'UNIT PRICE', 'DISCOUNT', 'SUB TOTAL'],
    rows: [['3-seater sofa (brown)', 'SOF-3-BR', '1', money(850), `-${money(20)}`, money(830)], ['Coffee table', 'TBL-CF-01', '2', money(175), money(0), money(350)]],
    align: ['left', 'left', 'center', 'right', 'right', 'right'], widths: [0, 28, 12, 25, 24, 27],
  },
  totals: [{ label: 'Before Discount', value: money(1200) }, { label: 'Discount', value: `-${money(20)}` }, { label: 'TOTAL', value: money(1180), strong: true }, { label: 'Amount Paid', value: money(500) }, { label: 'Balance Due', value: money(680), strong: true }],
  fileName: 'sample',
};

export function SettingsPage() {
  const { addToast } = useToast();
  const [form, setForm] = useState<DocumentLayout | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => { documentLayout(true).then(setForm); }, []);
  // Redraw the preview shortly after each change.
  useEffect(() => {
    if (!form) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      previewDocument(SAMPLE, form).then((u) => setUrl((old) => { if (old) URL.revokeObjectURL(old); return u; })).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer.current);
  }, [form]);
  if (!form) return <div className="panel" style={{ margin: 24 }}>Loading…</div>;
  const set = (k: keyof DocumentLayout) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const t = e.target as HTMLInputElement;
    setForm({ ...form, [k]: t.type === 'checkbox' ? t.checked : k === 'fontScale' ? Number(t.value) : t.value });
  };
  const save = async () => {
    setBusy(true);
    try { setForm(await apiPut<DocumentLayout>('/settings/document-layout', form)); forgetDocumentLayout(); addToast('success', 'Saved. Every document downloaded from now on uses this layout.'); }
    catch (e: any) { addToast('error', e?.message); } finally { setBusy(false); }
  };
  const text = (k: keyof DocumentLayout, label: string, ph = '') => (
    <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">{label}</span><input className="form-input" id={`doc-${k}`} value={String(form[k] ?? '')} onChange={set(k)} placeholder={ph} /></label>
  );
  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>Settings · Documents</h2>
      <p className="mm-sub" style={{ display: 'block', margin: '4px 0 16px' }}>How invoices, receipts, quotations, purchase invoices and statements look. The preview on the right updates as you type.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 16, display: 'grid', gap: 12 }}>
          {text('companyName', 'Company name *')}
          {text('tagline', 'Line under the name', 'e.g. Quality furniture since 1998')}
          {text('address', 'Address', 'e.g. 26 June Road, Hargeisa')}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>{text('phone', 'Phone')}{text('email', 'Email')}</div>
          {text('website', 'Website')}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">Colour</span><input className="form-input" id="doc-color" type="color" value={form.accentColor} onChange={set('accentColor')} style={{ padding: 2, height: 40 }} /></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">Paper</span><select className="form-select" id="doc-paper" value={form.paperSize} onChange={set('paperSize')}><option value="a4">A4</option><option value="letter">Letter</option><option value="a5">A5 (small)</option></select></label>
            <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">Text size</span><select className="form-select" id="doc-scale" value={String(form.fontScale)} onChange={set('fontScale')}><option value="0.9">Small</option><option value="1">Normal</option><option value="1.1">Large</option><option value="1.2">Larger</option></select></label>
          </div>
          {text('footerText', 'Footer', 'Thank you for your business.')}
          <label className="form-field" style={{ margin: 0 }}><span className="form-field__label">Terms and conditions (printed under the totals)</span><textarea className="form-input" id="doc-terms" rows={3} value={form.terms} onChange={set('terms')} placeholder="e.g. Goods are not returnable after 7 days. Delivery within Hargeisa is free." /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.showLogo} onChange={set('showLogo')} /> Show the Al Hayat logo</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" id="doc-signatures" checked={form.showSignatures} onChange={set('showSignatures')} /> Signature lines (received by / for the company)</label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}><input type="checkbox" checked={form.showGeneratedAt} onChange={set('showGeneratedAt')} /> Print the date and time the document was made</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn--primary" id="doc-save" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save layout'}</button>
            <button className="btn btn--secondary" onClick={() => setForm({ ...DEFAULT_LAYOUT })}>Back to the standard layout</button>
          </div>
        </div>
        <div className="panel" style={{ padding: 8 }}>
          {url ? <iframe id="doc-preview" title="Preview" src={url} style={{ width: '100%', height: 760, border: 0, borderRadius: 8 }} /> : <p className="mm-sub" style={{ display: 'block', padding: 16 }}>Drawing the preview…</p>}
        </div>
      </div>
    </div>
  );
}
