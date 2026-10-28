import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { useToast } from '../contexts/ToastContext';
import { confirmDelete } from '../utils/swal';
import {
  ACCEPTED_PHOTO_TYPES, listWebCategories, photoProblem, removeCategoryPhoto, uploadCategoryPhoto, type WebCategory,
} from '../api/storefront';

// Pictures for the category cards and menu on the website. A category without
// its own photo uses the main photo of one of its published products.
export function WebCategoriesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { addToast } = useToast();
  const [rows, setRows] = useState<WebCategory[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listWebCategories()
      .then((r) => { if (!cancelled) setRows(r); })
      .catch((err) => addToast('error', err?.message || 'Could not load categories'));
    return () => { cancelled = true; };
  }, [open, addToast]);

  if (!open) return null;

  const setImage = (id: string, imageUrl: string | null) =>
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, imageUrl } : r)) : prev));

  const pick = (id: string) => {
    target.current = id;
    fileInput.current?.click();
  };

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    const id = target.current;
    if (fileInput.current) fileInput.current.value = '';
    if (!file || !id) return;
    const problem = photoProblem(file);
    if (problem) { addToast('error', problem); return; }
    setBusyId(id);
    try {
      setImage(id, await uploadCategoryPhoto(id, file));
      addToast('success', 'Category photo updated');
    } catch (err: any) {
      addToast('error', err?.message || 'Photo upload failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: WebCategory) => {
    if (!(await confirmDelete('Remove category photo?', 'The website will use a product photo from this category instead.'))) return;
    setBusyId(row.id);
    try {
      await removeCategoryPhoto(row.id);
      setImage(row.id, null);
    } catch (err: any) {
      addToast('error', err?.message || 'Could not remove the photo');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen title="Website categories" onClose={onClose} width="lg">
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#64748b' }}>
        Each category appears on the website menu and home page with a picture. Upload one here, or leave it empty to use the main photo of one of its products.
        Only categories with published products are shown to customers.
      </p>
      <input ref={fileInput} type="file" accept={ACCEPTED_PHOTO_TYPES.join(',')} style={{ display: 'none' }} onChange={(e) => onFile(e.target.files)} aria-label="Choose category photo" />
      {!rows ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /> Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No categories yet. Create them under Manage Categories.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px' }}>
          {rows.map((row) => (
            <div key={row.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
              <div style={{ aspectRatio: '4 / 3', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt={row.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <span style={{ fontSize: '11px', color: '#94a3b8', padding: '8px', textAlign: 'center' }}>Uses a product photo</span>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{row.name}</div>
                <div style={{ fontSize: '11px', color: '#64748b' }}>{row.publishedCount} on the website</div>
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId !== null} onClick={() => pick(row.id)}>
                    {busyId === row.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ImagePlus size={13} />} {row.imageUrl ? 'Replace' : 'Upload'}
                  </button>
                  {row.imageUrl && (
                    <button type="button" className="btn btn-danger btn-sm" disabled={busyId !== null} onClick={() => remove(row)} aria-label={`Remove photo of ${row.name}`}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
