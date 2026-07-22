import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageSearch, Plus, Trash2, List, Settings } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, apiDownload } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { Modal } from '../components/Modal';
import { ConfirmModal } from '../components/ConfirmModal';
import { FormField, InputField } from '../components/FormField';
import { SearchableSelect } from '../components/SearchableSelect';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface Category {
  id: string;
  name: string;
}

interface Brand {
  id: string;
  name: string;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  category_id: string | null;
  brand_id: string | null;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
  category?: string;
  brand?: string;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  
  const [newProduct, setNewProduct] = useState({
    sku: '',
    barcode: '',
    name: '',
    description: '',
    categoryId: '',
    brandId: '',
    costPrice: 0,
    sellingPrice: 0,
    reorderLevel: 5,
  });

  // Initial stock to assign immediately on product creation
  const [initialStock, setInitialStock] = useState({ warehouseId: '', quantity: 0 });

  const [confirmState, setConfirmState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const fetchFilters = async () => {
    try {
      const [cats, brs] = await Promise.all([
        apiGet<Category[]>('/products/categories'),
        apiGet<Brand[]>('/products/brands'),
      ]);
      setCategories(cats || []);
      setBrands(brs || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      const prs = await apiGet<Product[]>('/products', { q: search });
      setProducts(prs || []);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchFilters();
    apiGet<{ id: string; name: string }[]>('/warehouses').then(res => setWarehouses(res || [])).catch(console.error);
  }, [search]);

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiPost('/products/categories', { name: newCategoryName });
      addToast('success', 'Category created successfully');
      setNewCategoryName('');
      fetchFilters();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create category');
    }
  };

  const handleDeleteCategory = async (id: string) => {
    setConfirmState({
      isOpen: true,
      title: 'Delete Category',
      message: 'Are you sure you want to delete this category?',
      onConfirm: async () => {
        try {
          await apiDelete(`/products/categories/${id}`);
          addToast('success', 'Category deleted successfully');
          fetchFilters();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete category');
        }
      }
    });
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProduct.sku || !newProduct.name || !newProduct.barcode) {
      addToast('error', 'Product ID, Barcode, and Name are required');
      return;
    }
    if (newProduct.costPrice > newProduct.sellingPrice) {
      addToast('error', 'Cost Price cannot be greater than Selling Price');
      return;
    }

    const payload: any = {
      sku: newProduct.sku,
      barcode: newProduct.barcode,
      name: newProduct.name,
      description: newProduct.description,
      costPrice: newProduct.costPrice,
      sellingPrice: newProduct.sellingPrice,
      reorderLevel: newProduct.reorderLevel,
    };
    if (newProduct.categoryId) payload.categoryId = newProduct.categoryId;
    if (newProduct.brandId) payload.brandId = newProduct.brandId;

    try {
      const created: any = await apiPost('/products', payload);
      // Auto-create inventory if initial stock was provided
      if (initialStock.warehouseId && initialStock.quantity > 0) {
        try {
          await apiPost('/inventory/adjust', {
            productId: created.id,
            direction: 'INCREASE',
            quantity: initialStock.quantity,
            ownerType: 'WAREHOUSE',
            warehouseId: initialStock.warehouseId,
            notes: 'Initial stock on product creation',
          });
        } catch (stockErr) {
          addToast('error', 'Product created but failed to add initial stock — add it manually in Inventory.');
        }
      }
      addToast('success', 'Product created successfully');
      setIsCreateOpen(false);
      setNewProduct({
        sku: '',
        barcode: '',
        name: '',
        description: '',
        categoryId: '',
        brandId: '',
        costPrice: 0,
        sellingPrice: 0,
        reorderLevel: 5,
      });
      setInitialStock({ warehouseId: '', quantity: 0 });
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create product');
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmState({
      isOpen: true,
      title: 'Delete Product',
      message: 'Are you sure you want to delete this product?',
      onConfirm: async () => {
        try {
          await apiDelete(`/products/${id}`);
          addToast('success', 'Product deleted successfully');
          loadData();
        } catch (err: any) {
          addToast('error', err?.message || 'Failed to delete product');
        }
      }
    });
  };

  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    try {
      await apiPatch(`/products/${editingProduct.id}`, {
        sku: editingProduct.sku,
        barcode: editingProduct.barcode,
        name: editingProduct.name,
        description: editingProduct.description,
        categoryId: editingProduct.category_id || null,
        brandId: editingProduct.brand_id || null,
        costPrice: editingProduct.cost_price,
        sellingPrice: editingProduct.selling_price,
        reorderLevel: editingProduct.reorder_level,
      });
      addToast('success', 'Product updated successfully');
      setIsEditOpen(false);
      setEditingProduct(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update product');
    }
  };

  const filteredProducts = products.filter((p) => {
    if (!selectedCategory) return true;
    return p.category_id === selectedCategory;
  });

  const columns: Column<Product>[] = [
    { key: 'sku', label: 'Product ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', render: (row) => row.category || 'N/A' },
    { key: 'brand', label: 'Brand', render: (row) => row.brand || 'N/A' },
    { key: 'cost_price', label: 'Cost Price', render: (row) => `$${Number(row.cost_price).toLocaleString()}` },
    { key: 'selling_price', label: 'Selling Price', render: (row) => `$${Number(row.selling_price).toLocaleString()}` },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                setEditingProduct(row);
                setIsEditOpen(true);
              }}
            >
              Edit
            </button>
          )}
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={(e) => handleDelete(row.id, e)}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="module-page">
      <section className="module-header">
        <div className="module-header__icon">
          <PackageSearch size={24} />
        </div>
        <div>
          <p>Catalog</p>
          <h2>Products, images, and barcode lookup</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {hasPermission('manage_inventory') && (
            <button type="button" className="btn btn-secondary" onClick={() => setIsCategoryModalOpen(true)}>
              Manage Categories
            </button>
          )}
          {hasPermission('manage_inventory') && (
            <button type="button" className="btn btn-primary" onClick={() => setIsCreateOpen(true)}>
              <Plus size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> New Product
            </button>
          )}
        </div>
      </section>

      <Modal isOpen={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} title="Manage Categories">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <form onSubmit={handleCreateCategory} style={{ display: 'flex', gap: '8px' }}>
            <input type="text" className="form-input" style={{ flex: 1 }} required placeholder="New Category Name" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
            <button type="submit" className="btn btn-primary">Add</button>
          </form>
          <div style={{ maxHeight: '300px', overflowY: 'auto', border: '1px solid #e1e8e1', borderRadius: '8px' }}>
            {categories.map(c => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #e1e8e1' }}>
                <span>{c.name}</span>
                <button type="button" onClick={() => handleDeleteCategory(c.id)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {categories.length === 0 && <div style={{ padding: '12px', textAlign: 'center', color: '#667066' }}>No categories found</div>}
          </div>
        </div>
      </Modal>

      <section className="panel" style={{ display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: '1', minWidth: '240px' }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search by Product ID, Name or Description..." />
        </div>
        <div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="form-select"
            style={{ minHeight: '38px', borderRadius: '8px', border: '1px solid #d9e2d9', padding: '0 10px' }}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        <DataTable
          columns={columns}
          data={filteredProducts}
          keyExtractor={(row) => row.id}
          loading={loading}
          emptyMessage="No products match the criteria"
        />
      </section>

      {/* Create Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Create New Product" width="lg">
        <form onSubmit={handleCreateProduct}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.5fr', gap: '14px' }}>
            <InputField
              label="Product ID"
              id="sku"
              value={newProduct.sku}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, sku: val }))}
              required
            />
            <InputField
              label="Barcode"
              id="barcode"
              value={newProduct.barcode}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, barcode: val }))}
              required
            />
            <InputField
              label="Product Name"
              id="name"
              value={newProduct.name}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, name: val }))}
              required
            />
          </div>

          <div style={{ marginTop: '10px' }}>
            <label className="form-field__label">Description</label>
            <textarea
              className="form-textarea"
              value={newProduct.description}
              onChange={(e) => setNewProduct((prev) => ({ ...prev, description: e.target.value }))}
              rows={2}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <FormField label="Category">
              <SearchableSelect
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                value={newProduct.categoryId}
                onChange={(val) => setNewProduct((prev) => ({ ...prev, categoryId: val }))}
                placeholder="Search Category..."
              />
            </FormField>
            <FormField label="Brand">
              <SearchableSelect
                options={brands.map((b) => ({ value: b.id, label: b.name }))}
                value={newProduct.brandId}
                onChange={(val) => setNewProduct((prev) => ({ ...prev, brandId: val }))}
                placeholder="Search Brand..."
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
            <InputField
              label="Cost Price ($) *"
              id="costPrice"
              type="number"
              value={newProduct.costPrice}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, costPrice: Number(val) }))}
              required
            />
            <InputField
              label="Selling Price ($) *"
              id="sellingPrice"
              type="number"
              value={newProduct.sellingPrice}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, sellingPrice: Number(val) }))}
              required
            />
          </div>

          {/* Initial Stock Section */}
          <div style={{ marginTop: '16px', padding: '14px', background: '#f4fbf4', borderRadius: '8px', border: '1px solid #d1e8d1' }}>
            <p style={{ margin: '0 0 10px', fontWeight: 600, color: '#066006', fontSize: '14px' }}>📦 Initial Stock (Optional)</p>
            <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#667066' }}>Assign stock immediately so this product appears in Inventory right away.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormField label="Warehouse">
                <SearchableSelect
                  options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                  value={initialStock.warehouseId}
                  onChange={(val) => setInitialStock((prev) => ({ ...prev, warehouseId: val }))}
                  placeholder="Skip — add stock later"
                />
              </FormField>
              <InputField
                label="Opening Quantity"
                id="initQty"
                type="number"
                min={0}
                value={initialStock.quantity}
                onChange={(val) => setInitialStock(prev => ({ ...prev, quantity: Number(val) }))}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Product
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Product Modal */}
      {isEditOpen && editingProduct && (
        <Modal isOpen={isEditOpen} title="Edit Product" onClose={() => { setIsEditOpen(false); setEditingProduct(null); }}>
          <form onSubmit={handleEditProduct}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <InputField label="Product ID (SKU) *" id="editSku" value={editingProduct.sku} onChange={(val) => setEditingProduct({ ...editingProduct, sku: val })} required />
              <InputField label="Barcode *" id="editBarcode" value={editingProduct.barcode || ''} onChange={(val) => setEditingProduct({ ...editingProduct, barcode: val })} required />
            </div>
            <div style={{ marginTop: '10px' }}>
              <InputField label="Name *" id="editName" value={editingProduct.name} onChange={(val) => setEditingProduct({ ...editingProduct, name: val })} required />
            </div>
            <div className="form-group" style={{ marginTop: '10px' }}>
              <label>Description</label>
              <textarea
                style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                rows={3}
                value={editingProduct.description || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                placeholder="Detailed product description..."
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
              <div className="form-group">
                <label>Category</label>
                <select
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                  value={editingProduct.category_id || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, category_id: e.target.value })}
                >
                  <option value="">No Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Brand</label>
                <select
                  style={{ width: '100%', padding: '8px', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                  value={editingProduct.brand_id || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, brand_id: e.target.value })}
                >
                  <option value="">No Brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginTop: '10px' }}>
              <InputField type="number" label="Cost Price ($) *" id="editCost" value={editingProduct.cost_price.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, cost_price: parseFloat(val) })} required />
              <InputField type="number" label="Selling Price ($) *" id="editSell" value={editingProduct.selling_price.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, selling_price: parseFloat(val) })} required />
              <InputField type="number" label="Reorder Level *" id="editReorder" value={editingProduct.reorder_level.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, reorder_level: parseInt(val, 10) })} required />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setIsEditOpen(false); setEditingProduct(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </Modal>
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        isDestructive={true}
        onConfirm={confirmState.onConfirm}
        onCancel={() => setConfirmState(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
