import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Package, Warehouse, Building, Layers } from 'lucide-react';
import { apiGet } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../contexts/ToastContext';

interface ProductVariant {
  id: string;
  product_id: string;
  sku: string;
  barcode: string;
  color: string | null;
  material: string | null;
  dimensions: string | null;
  is_active: boolean;
}

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
  variants?: ProductVariant[];
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
        const variantIds = new Set(prod.variants?.map(v => v.id) || []);
        const filteredStocks = (stocks || []).filter(s => variantIds.has(s.variant_id));
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
    return <LoadingSpinner label="Fetching product specifications..." />;
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

  const variantColumns: Column<ProductVariant>[] = [
    { key: 'sku', label: 'Variant SKU' },
    { key: 'barcode', label: 'Barcode' },
    { key: 'color', label: 'Color', render: (row) => row.color || 'N/A' },
    { key: 'material', label: 'Material', render: (row) => row.material || 'N/A' },
    { key: 'dimensions', label: 'Dimensions', render: (row) => row.dimensions || 'N/A' },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <StatusBadge label={row.is_active ? 'Active' : 'Inactive'} tone={row.is_active ? 'green' : 'neutral'} />,
    },
  ];

  const stockColumns: Column<any>[] = [
    {
      key: 'location',
      label: 'Location',
      render: (row) => {
        if (row.owner_type === 'WAREHOUSE') {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Warehouse size={14} style={{ color: '#0b8f08' }} />
              <span>{row.warehouse || 'Warehouse'}</span>
              {row.aisle && <span style={{ color: '#667066' }}>({row.aisle}-{row.rack}-{row.shelf}-{row.bin})</span>}
            </div>
          );
        } else {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building size={14} style={{ color: '#b45309' }} />
              <span>{row.branch || 'Branch'}</span>
            </div>
          );
        }
      },
    },
    { key: 'sku', label: 'Variant SKU' },
    { key: 'quantity_on_hand', label: 'Qty On Hand' },
    { key: 'quantity_reserved', label: 'Reserved' },
    {
      key: 'available',
      label: 'Available',
      render: (row) => {
        const avail = row.quantity_on_hand - row.quantity_reserved;
        return <span style={{ fontWeight: '600' }}>{avail}</span>;
      },
    },
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
              <span style={{ color: '#667066', fontSize: '13px' }}>SKU Prefix:</span>
              <strong style={{ fontSize: '13px' }}>{product.sku}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Cost Price:</span>
              <strong style={{ fontSize: '13px' }}>SAR {Number(product.cost_price).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Selling Price:</span>
              <strong style={{ fontSize: '13px' }}>SAR {Number(product.selling_price).toLocaleString()}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#667066', fontSize: '13px' }}>Reorder Level:</span>
              <strong style={{ fontSize: '13px' }}>{product.reorder_level} units</strong>
            </div>
          </div>
        </div>
      </section>

      {/* Details Grid */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', alignItems: 'start' }}>
        {/* Variants Panel */}
        <div className="panel">
          <div className="panel__header">
            <div>
              <p>Specification</p>
              <h2>Defined Product Variants</h2>
            </div>
            <Layers size={18} style={{ color: '#0b8f08' }} />
          </div>
          <DataTable
            columns={variantColumns}
            data={product.variants || []}
            keyExtractor={(row) => row.id}
            emptyMessage="No variants defined for this product"
          />
        </div>

        {/* Stock Levels Panel */}
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
            emptyMessage="No stock levels reported for these variants"
          />
        </div>
      </section>
    </div>
  );
}
