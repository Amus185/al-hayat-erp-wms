import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Star, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { InputField, TextareaField } from './FormField';
import { StatusBadge } from './StatusBadge';
import { useToast } from '../contexts/ToastContext';
import { confirmDelete } from '../utils/swal';
import {
  ACCEPTED_PHOTO_TYPES, deleteImage, getProductWeb, photoProblem, reorderImages, saveProductWeb, uploadProductPhoto,
  type ProductWeb, type WebImage,
} from '../api/storefront';

interface Props {
  product: { id: string; name: string } | null;
  onClose: () => void;
  /** Called after publish state changes, so the product list can refresh its badge. */
  onChanged: (productId: string, isPublished: boolean) => void;
}

export function ProductWebPanel({ product, onClose, onChanged }: Props) {
  const { addToast } = useToast();
  const [web, setWeb] = useState<ProductWeb | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [wasPrice, setWasPrice] = useState('');
  const [featured, setFeatured] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    setWeb(null);
    setLoading(true);
    getProductWeb(product.id)
      .then((w) => {
        if (cancelled) return;
        setWeb(w);
        setSlug(w.slug ?? '');
        setDescription(w.webDescription ?? '');
        setWasPrice(w.compareAtPrice == null ? '' : String(w.compareAtPrice));
        setFeatured(w.isFeatured);
      })
      .catch((err) => { if (!cancelled) addToast('error', err?.message || 'Could not load website details'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  if (!product) return null;

  const setImages = (images: WebImage[]) => setWeb((w) => (w ? { ...w, images } : w));

  const run = async (work: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await work();
    } catch (err: any) {
      addToast('error', err?.message || failure);
    } finally {
      setBusy(false);
    }
  };

  const handleFiles = (files: FileList | null) => {
    const picked = Array.from(files || []);
    if (fileInput.current) fileInput.current.value = '';
    if (!picked.length) return;
    run(async () => {
      // One at a time: each upload is presigned and registered separately.
      for (const file of picked) {
        const problem = photoProblem(file);
        if (problem) { addToast('error', problem); continue; }
        setImages(await uploadProductPhoto(product.id, file));
      }
    }, 'Photo upload failed');
  };

  const move = (index: number, by: number) => {
    if (!web) return;
    const ids = web.images.map((i) => i.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(async () => setImages((await reorderImages(product.id, ids)).images), 'Could not reorder photos');
  };

  const remove = async (image: WebImage) => {
    const ok = await confirmDelete('Delete photo?', 'The photo is removed from the website and from storage.');
    if (!ok) return;
    run(async () => setImages((await deleteImage(product.id, image.id)).images), 'Could not delete the photo');
  };

  const save = (publish: boolean) =>
    run(async () => {
      const saved = await saveProductWeb(product.id, {
        isPublished: publish,
        slug: slug.trim() || undefined,
        webDescription: description,
        compareAtPrice: wasPrice.trim() === '' ? null : Number(wasPrice),
        isFeatured: featured,
      });
      setWeb(saved);
      setSlug(saved.slug ?? '');
      setWasPrice(saved.compareAtPrice == null ? '' : String(saved.compareAtPrice));
      onChanged(product.id, saved.isPublished);
      addToast('success', publish ? (web?.isPublished ? 'Website details saved' : 'Published to the website') : 'Removed from the website');
    }, 'Could not save');

  const published = web?.isPublished ?? false;

  return (
    <Modal isOpen title={`Website — ${product.name}`} onClose={onClose} width="lg">
      {loading || !web ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={22} className="spin" style={{ animation: 'spin 1s linear infinite' }} /> Loading…
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <StatusBadge label={published ? 'Published' : 'Not on the website'} tone={published ? 'green' : 'neutral'} />
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              {published ? 'Customers can see this product.' : 'Customers cannot see this product yet.'}
            </span>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <strong style={{ fontSize: '13px' }}>Photos ({web.images.length}/10)</strong>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy || web.images.length >= 10} onClick={() => fileInput.current?.click()}>
                {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ImagePlus size={14} />} Add photos
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept={ACCEPTED_PHOTO_TYPES.join(',')}
                style={{ display: 'none' }}
                onChange={(e) => handleFiles(e.target.files)}
                aria-label="Choose product photos"
              />
            </div>
            {web.images.length === 0 ? (
              <div style={{ border: '1.5px dashed #cbd5e1', borderRadius: '10px', padding: '22px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                No photos yet. A product needs at least one photo before it can be published. JPEG, PNG or WebP, up to 5 MB each.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '10px' }}>
                {web.images.map((img, i) => (
                  <div key={img.id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', overflow: 'hidden', background: '#fff' }}>
                    <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#f1f5f9' }}>
                      {img.url ? (
                        <img src={img.url} alt={img.alt || web.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      ) : (
                        <div style={{ padding: '10px', fontSize: '11px', color: '#94a3b8' }}>Preview unavailable</div>
                      )}
                      {img.isPrimary && (
                        <span style={{ position: 'absolute', top: 6, left: 6, background: '#066006', color: '#fff', borderRadius: '6px', padding: '2px 6px', fontSize: '10px', fontWeight: 700, display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
                          <Star size={10} /> Main
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px' }}>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || i === 0} onClick={() => move(i, -1)} title="Move earlier (the first photo is the main one)" aria-label="Move photo earlier"><ArrowLeft size={13} /></button>
                      <button type="button" className="btn btn-secondary btn-sm" disabled={busy || i === web.images.length - 1} onClick={() => move(i, 1)} title="Move later" aria-label="Move photo later"><ArrowRight size={13} /></button>
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => remove(img)} title="Delete photo" aria-label="Delete photo"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <InputField
            label="Web address"
            id="web-slug"
            value={slug}
            onChange={(v) => setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
            placeholder="created automatically from the product name"
          />
          <TextareaField
            label="Description shown to customers"
            id="web-description"
            value={description}
            onChange={setDescription}
            rows={5}
            placeholder="Materials, dimensions, colours, care instructions…"
          />

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px', alignItems: 'end' }}>
            <div>
              <InputField
                label="“Was” price for a sale (optional)"
                id="web-was-price"
                type="number"
                min={0}
                step={0.01}
                value={wasPrice}
                onChange={setWasPrice}
                placeholder="leave empty if not on sale"
              />
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: '#64748b' }}>
                Shown crossed out next to today’s price (${web.sellingPrice.toFixed(2)}). Must be higher. Customers are always charged today’s price.
              </p>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', paddingBottom: '22px', cursor: 'pointer' }}>
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
              Feature on the website home page
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
            {published ? (
              <>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(false)} style={{ color: '#b45309' }}>Remove from website</button>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => save(true)}>Save changes</button>
              </>
            ) : (
              <>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => save(false)}>Save draft</button>
                <button type="button" className="btn btn-primary" disabled={busy || web.images.length === 0} onClick={() => save(true)} title={web.images.length === 0 ? 'Add a photo first' : undefined}>Publish to website</button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
