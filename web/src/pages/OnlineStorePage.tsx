// Online store: the ERP's one place for the public shop. The shop has no
// database of its own: products, prices, photos and stock are the ERP's, and
// its orders are handled here.
//   Overview  orders waiting and today, what is on the shop, what is running low
//   Products  every product with its shop state, photos and web stock; publish, photos
//   Orders    the web orders inbox (confirm, convert to a sales order, cancel)
//   Settings  which branch the shop sells from, buffer, quantities, categories (administrators)
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, ExternalLink, Globe, ImageIcon, Package, ShoppingBag, Store } from 'lucide-react';
import { DataTable, type Column } from '../components/DataTable';
import { MetricCard } from '../components/MetricCard';
import { ProductWebPanel } from '../components/ProductWebPanel';
import { SearchInput } from '../components/SearchInput';
import { StatusBadge } from '../components/StatusBadge';
import { Tabs } from '../components/Tabs';
import { WebCategoriesPanel } from '../components/WebCategoriesPanel';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  SHOP_URL, getStoreOverview, listStoreProducts, saveProductWeb, type StoreOverview, type StoreProduct,
} from '../api/storefront';
import { StorefrontSettingsCard, WebRequestsPage } from './WebRequestsPage';

type Tab = 'overview' | 'products' | 'orders' | 'settings';
const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function OnlineStorePage() {
  const { hasPermission, isAdmin } = useAuth();
  const canProducts = hasPermission('manage_inventory');
  const canOrders = hasPermission('manage_sales');
  const [params, setParams] = useSearchParams();
  const tabs = useMemo(() => [
    { key: 'overview', label: 'Overview' },
    ...(canProducts ? [{ key: 'products', label: 'Products on the shop' }] : []),
    ...(canOrders ? [{ key: 'orders', label: 'Orders' }] : []),
    ...(isAdmin ? [{ key: 'settings', label: 'Settings' }] : []),
  ], [canProducts, canOrders, isAdmin]);
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && tabs.some((t) => t.key === requested) ? requested : 'overview';
  const go = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon"><Store size={24} /></div>
        <div style={{ flex: 1 }}>
          <p>Website</p>
          <h2>Online store</h2>
        </div>
        {SHOP_URL && (
          <a className="btn btn-secondary" href={SHOP_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ExternalLink size={16} /> Open the shop
          </a>
        )}
      </section>

      <Tabs id="online-store-tabs" activeTab={tab} onTabChange={(k) => go(k as Tab)} tabs={tabs} />

      {tab === 'overview' && <Overview onOpen={go} />}
      {tab === 'products' && canProducts && <StoreProducts />}
      {tab === 'orders' && canOrders && <WebRequestsPage embedded />}
      {tab === 'settings' && isAdmin && <StoreSettings />}
    </div>
  );
}

function Overview({ onOpen }: { onOpen: (t: Tab) => void }) {
  const { addToast } = useToast();
  const [data, setData] = useState<StoreOverview | null>(null);

  useEffect(() => {
    getStoreOverview().then(setData).catch((err) => addToast('error', err?.message || 'Could not load the online store overview'));
  }, [addToast]);

  if (!data) return <div className="card" style={{ padding: '20px', color: '#64748b' }}>Loading…</div>;

  const problems = [
    !data.sellsFrom && 'Choose the branch the shop sells from (Settings). Until then every product shows as sold out.',
    !data.imagesConfigured && 'Photo storage is not set up on the server yet, so product photos cannot be uploaded.',
    !data.requestsConfigured && 'The shop\'s order key is not set on the server yet, so customers cannot place orders.',
  ].filter(Boolean) as string[];

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      {problems.map((p) => (
        <div key={p} role="alert" style={{ display: 'flex', gap: '8px', alignItems: 'center', background: '#fffbeb', border: '1px solid #fcd34d', color: '#7c4a03', borderRadius: '8px', padding: '10px 12px', fontSize: '13px' }}>
          <AlertTriangle size={16} /> {p}
        </div>
      ))}
      <section className="metric-grid">
        <MetricCard id="store-awaiting" label="Orders waiting for confirmation" value={String(data.orders.awaiting)} icon={<ShoppingBag size={20} />}
          trend={data.orders.awaiting ? 'Open Orders to confirm them' : 'All handled'} onClick={() => onOpen('orders')} />
        <MetricCard id="store-today" label="Orders today" value={String(data.orders.today)} trend={money(data.orders.todayValue)} icon={<Globe size={20} />} onClick={() => onOpen('orders')} />
        <MetricCard id="store-month" label="Orders this month" value={String(data.orders.month)} trend={money(data.orders.monthValue)} icon={<Globe size={20} />} />
        <MetricCard id="store-products" label="Products on the shop" value={String(data.publishedProducts)}
          trend={data.sellsFrom ? `Stock from ${data.sellsFrom}` : 'No branch chosen'} icon={<Package size={20} />} onClick={() => onOpen('products')} />
      </section>
      <div className="card" style={{ padding: '16px' }}>
        <strong>Running low or sold out on the shop</strong>
        {data.lowOrOut.length === 0 ? (
          <p style={{ margin: '8px 0 0', color: '#64748b', fontSize: '14px' }}>Everything on the shop is in stock.</p>
        ) : (
          <ul style={{ margin: '8px 0 0', paddingLeft: '18px', display: 'grid', gap: '4px', fontSize: '14px' }}>
            {data.lowOrOut.map((p) => (
              <li key={p.id}>
                {p.name}: <strong style={{ color: p.units === 0 ? '#b91c1c' : '#b45309' }}>{p.units === 0 ? 'sold out' : `${p.units} left`}</strong>
              </li>
            ))}
          </ul>
        )}
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>
          Stock is the ERP's own: receive or transfer stock to the shop's branch and the shop updates at once.
        </p>
      </div>
    </div>
  );
}

type Filter = 'all' | 'on' | 'off';

function StoreProducts() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [panel, setPanel] = useState<{ id: string; name: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listStoreProducts(search || undefined));
    } catch (err: any) {
      addToast('error', err?.message || 'Could not load products');
    } finally {
      setLoading(false);
    }
  }, [search, addToast]);
  useEffect(() => { load(); }, [load]);

  const togglePublished = async (p: StoreProduct) => {
    setBusyId(p.id);
    try {
      await saveProductWeb(p.id, { isPublished: !p.isPublished });
      addToast('success', p.isPublished ? `${p.name} removed from the shop` : `${p.name} is now on the shop`);
      await load();
    } catch (err: any) {
      addToast('error', err?.message || 'Could not change this product');
    } finally {
      setBusyId(null);
    }
  };

  const shown = rows.filter((r) => (filter === 'on' ? r.isPublished : filter === 'off' ? !r.isPublished : true));
  const stock = (p: StoreProduct) => {
    if (p.availability === 'OUT') return <StatusBadge label="Sold out" tone="red" />;
    if (p.availability === 'LOW') return <StatusBadge label={`${p.webUnits} left`} tone="yellow" />;
    return <StatusBadge label={`${p.webUnits} in stock`} tone="green" />;
  };

  const columns: Column<StoreProduct & Record<string, unknown>>[] = [
    {
      key: 'photo', label: '', width: '56px',
      render: (p) => p.photoUrl
        ? <img src={p.photoUrl} alt="" style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '6px' }} />
        : <div style={{ width: '40px', height: '40px', borderRadius: '6px', background: '#f1f5f9', display: 'grid', placeItems: 'center', color: '#94a3b8' }}><ImageIcon size={16} /></div>,
    },
    { key: 'name', label: 'Product', render: (p) => <div><strong>{p.name}</strong><div style={{ fontSize: '12px', color: '#64748b' }}>{[p.sku, p.category].filter(Boolean).join(' · ')}</div></div> },
    {
      key: 'price', label: 'Price', render: (p) => (
        <span>{money(p.price)}{p.compareAtPrice && p.compareAtPrice > p.price ? <span style={{ marginLeft: '6px', color: '#94a3b8', textDecoration: 'line-through', fontSize: '12px' }}>{money(p.compareAtPrice)}</span> : null}</span>
      ),
    },
    { key: 'webUnits', label: 'Shop stock', render: stock },
    { key: 'photoCount', label: 'Photos', render: (p) => <span style={{ color: p.photoCount ? undefined : '#b45309' }}>{p.photoCount || 'None'}</span> },
    { key: 'isPublished', label: 'On the shop', render: (p) => <StatusBadge label={p.isPublished ? 'Published' : 'Hidden'} tone={p.isPublished ? 'green' : 'neutral'} /> },
    {
      key: 'actions', label: '', render: (p) => (
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <button type="button" className="btn btn-secondary" onClick={() => setPanel({ id: p.id, name: p.name })}>Photos &amp; details</button>
          <button type="button" className={p.isPublished ? 'btn btn-secondary' : 'btn btn-primary'} disabled={busyId === p.id || (!p.isPublished && !p.photoCount)}
            title={!p.isPublished && !p.photoCount ? 'Add a photo first' : undefined} onClick={() => togglePublished(p)}>
            {p.isPublished ? 'Hide' : 'Publish'}
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="card" style={{ padding: '16px', display: 'grid', gap: '12px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: '1 1 260px' }}><SearchInput id="store-product-search" value={search} onChange={setSearch} placeholder="Search products by name or SKU…" /></div>
        <Tabs id="store-product-filter" activeTab={filter} onTabChange={(k) => setFilter(k as Filter)}
          tabs={[{ key: 'all', label: `All (${rows.length})` }, { key: 'on', label: `Published (${rows.filter((r) => r.isPublished).length})` }, { key: 'off', label: 'Hidden' }]} />
      </div>
      <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
        Names, prices, categories and stock are edited in Products and Inventory, and the shop shows changes immediately. Here you choose what is on the shop and manage its photos.
      </p>
      <DataTable
        id="store-products"
        columns={columns}
        data={shown as (StoreProduct & Record<string, unknown>)[]}
        keyExtractor={(p) => p.id}
        loading={loading}
        emptyMessage={search ? 'No product matches.' : 'No products yet. Add them in Products.'}
        onRowClick={(p) => setPanel({ id: p.id, name: p.name })}
      />
      <ProductWebPanel product={panel} onClose={() => setPanel(null)} onChanged={() => { load(); }} />
    </div>
  );
}

function StoreSettings() {
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <StorefrontSettingsCard />
      <div className="card" style={{ padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <strong>Shop categories</strong>
          <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#64748b' }}>The picture shown for each category on the shop's home page.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setCategoriesOpen(true)}>Category pictures</button>
      </div>
      <WebCategoriesPanel open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </div>
  );
}
