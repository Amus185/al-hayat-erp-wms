import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Warehouse, Building } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { PageSkeleton } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category_id: string | null;
  brand_id: string | null;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
  category?: string;
  brand?: string;
}

export function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [stockLevels, setStockLevels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProductDetails() {
      if (!id) return;
      try {
        setLoading(true);
        const prod = await apiGet<ProductDetail>(`/products/${id}`);
        setProduct(prod);

        // Fetch all stock records and filter for this product's variants
        const stocks = await apiGet<any[]>('/inventory/stock');
        
        // Map variants to IDs for fast lookup
        const filteredStocks = (stocks || []).filter(s => s.product_id === prod.id);
        setStockLevels(filteredStocks);
      } catch (err: any) {
        addToast('error', err?.message || 'Failed to load product details');
      } finally {
        setLoading(false);
      }
    }
    fetchProductDetails();
  }, [id]);

  if (loading) {
    return <PageSkeleton />;
  }

  if (!product) {
    return (
      <div className="empty-state">
        <Package size={48} />
        <p>Product not found</p>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/products')}>
          Back to Catalog
        </button>
      </div>
    );
  }

  const stockColumns: Column<any>[] = [
    {
      key: 'location',
      label: 'Location',
      render: (row) => row.owner_type === 'WAREHOUSE' ? `Warehouse: ${row.warehouse || '-'}` : `Branch: ${row.branch || '-'}`,
    },
    {
      key: 'shelf',
      label: 'Bin/Shelf',
      render: (row) => row.owner_type === 'WAREHOUSE' && row.aisle ? `${row.aisle}-${row.rack}-${row.shelf}-${row.bin}` : '-',
    },
    { key: 'quantity_on_hand', label: 'On Hand' },
    { key: 'quantity_reserved', label: 'Reserved' },
  ];

  return (
    <div className="module-page">
      <section style={{ marginBottom: '10px' }}>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/products')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <ArrowLeft size={16} /> Back to Catalog
        </button>
      </section>

      {/* Main product card */}
      <section className="panel" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <p style={{ color: '#667066', textTransform: 'uppercase', fontSize: '12px', fontWeight: '700' }}>{product.category || 'Product Category'}</p>
            <h1 style={{ margin: '4px 0 10px', fontSize: '28px', color: '#066006' }}>{product.name}</h1>
            <p style={{ color: '#394339', fontSize: '14px', maxWidth: '600px' }}>{product.description || 'No description provided.'}</p>
          </div>
          <div style={{ background: '#f7f9f7', padding: '16px', borderRadius: '8px', border: '1px solid #e1e8e1', minWidth: '200px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Product ID:</span>
              <strong style={{ fontSize: '13px' }}>{product.sku}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Cost Price:</span>
              <strong style={{ fontSize: '13px' }}>$${Number(product.cost_price).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Selling Price:</span>
              <strong style={{ fontSize: '13px' }}>$${Number(product.selling_price).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Reorder Level:</span>
              <strong style={{ fontSize: '13px' }}>{product.reorder_level} units</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Stock Levels Panel */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px', alignItems: 'start' }}>
        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Inventory Distribution</p>
              <h2>Stock Levels per Location</h2>
            </div>
            <Warehouse size={18} style={{ color: '#0b8f08' }} />
          </div>
          <DataTable
            columns={stockColumns}
            data={stockLevels}
            keyExtractor={(row) => row.id}
            emptyMessage="No stock levels reported for this product"
          />
        </div>
      </section>
    </div>
  );
}
