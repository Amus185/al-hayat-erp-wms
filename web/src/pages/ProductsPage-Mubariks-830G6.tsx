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
  const [loading, setLoading] = useState(true);

  // Filters & Pagination
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortBy, setSortBy] = useState('p.name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        sort_by: sortBy,
        sort_dir: sortDir.toUpperCase(),
      });
      if (search) params.append('search', search);
      if (categoryId) params.append('category_id', categoryId);
      if (brandId) params.append('brand_id', brandId);

      const res = await apiGet<any>(`/products?${params.toString()}`);
      setProducts(res.data || []);
      setTotal(res.total || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFilters();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(loadData, 300);
    return () => clearTimeout(timeout);
  }, [page, sortBy, sortDir, search, categoryId, brandId]);

  const handleExport = async () => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (categoryId) params.append('category_id', categoryId);
    if (brandId) params.append('brand_id', brandId);
    params.append('sort_by', sortBy);
    params.append('sort_dir', sortDir.toUpperCase());
    params.append('export', 'csv');
    try {
      await apiDownload(`/products?${params.toString()}`, 'products.csv');
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to export CSV');
    }
  };

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
      await apiPost('/products', payload);
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
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create product');
    }
  };

  const handleEditProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    
    if (!editingProduct.sku || !editingProduct.name || !editingProduct.barcode) {
      addToast('error', 'Product ID, Barcode, and Name are required');
      return;
    }
    if (editingProduct.cost_price > editingProduct.selling_price) {
      addToast('error', 'Cost Price cannot be greater than Selling Price');
      return;
    }

    const payload: any = {
      sku: editingProduct.sku,
      barcode: editingProduct.barcode,
      name: editingProduct.name,
      description: editingProduct.description,
      costPrice: editingProduct.cost_price,
      sellingPrice: editingProduct.selling_price,
      reorderLevel: editingProduct.reorder_level,
    };
    if (editingProduct.category_id) payload.categoryId = editingProduct.category_id;
    if (editingProduct.brand_id) payload.brandId = editingProduct.brand_id;

    try {
      await apiPatch(`/products/${editingProduct.id}`, payload);
      addToast('success', 'Product updated successfully');
      setIsEditOpen(false);
      setEditingProduct(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update product');
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

  const columns: Column<Product>[] = [
    { key: 'sku', label: 'Product ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', sortable: true, render: (row) => row.category || 'N/A' },
    { key: 'brand', label: 'Brand', sortable: true, render: (row) => row.brand || 'N/A' },
    { key: 'cost_price', label: 'Cost Price', sortable: true, render: (row) => `$${Number(row.cost_price).toLocaleString()}` },
    { key: 'selling_price', label: 'Selling Price', sortable: true, render: (row) => `$${Number(row.selling_price).toLocaleString()}` },
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

      <section className="panel" style={{ marginBottom: '14px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end', padding: '16px' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Search</label>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: '10px', top: '9px', color: '#9ca3af' }}>🔍</span>
            <input type="text" className="form-input" style={{ paddingLeft: '34px' }} placeholder="Product ID, Name or Barcode" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div style={{ width: '180px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Category</label>
          <select className="form-select" value={categoryId} onChange={e => setCategoryId(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={{ width: '180px' }}>
          <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Brand</label>
          <select className="form-select" value={brandId} onChange={e => setBrandId(e.target.value)}>
            <option value="">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setCategoryId(''); setBrandId(''); setPage(1); }}>
          Clear
        </button>
        <button type="button" className="btn btn-secondary" onClick={handleExport}>
          <List size={16} style={{ marginRight: '6px', inlineSize: 'auto' }} /> CSV
        </button>
      </section>

      <section className="panel" style={{ padding: 0 }}>
        <DataTable
          columns={columns}
          data={products}
          keyExtractor={(row) => row.id}
          loading={loading}
          emptyMessage="No products found matching your filters"
          sortBy={sortBy === 'p.name' ? 'name' : sortBy === 'p.sku' ? 'sku' : sortBy === 'c.name' ? 'category' : sortBy === 'b.name' ? 'brand' : sortBy === 'p.cost_price' ? 'cost_price' : 'selling_price'}
          sortOrder={sortDir}
          onSort={(key: string) => {
            let dbKey = key;
            if (key === 'sku') dbKey = 'p.sku';
            if (key === 'name') dbKey = 'p.name';
            if (key === 'category') dbKey = 'c.name';
            if (key === 'brand') dbKey = 'b.name';
            if (key === 'cost_price') dbKey = 'p.cost_price';
            if (key === 'selling_price') dbKey = 'p.selling_price';
            
            if (sortBy === dbKey) {
              setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
            } else {
              setSortBy(dbKey);
              setSortDir('asc');
            }
          }}
          pagination={{ page, total, limit: 50, totalPages, onPageChange: setPage }}
        />
      </section>

      {/* Edit Product Modal */}
      {isEditOpen && editingProduct && (
        <Modal title="Edit Product" onClose={() => { setIsEditOpen(false); setEditingProduct(null); }}>
          <form onSubmit={handleEditProduct}>
            <div className="form-row">
              <FormField label="Product ID (SKU)" required>
                <InputField value={editingProduct.sku} onChange={(val) => setEditingProduct({ ...editingProduct, sku: val })} placeholder="e.g. LAP-001" />
              </FormField>
              <FormField label="Barcode" required>
                <InputField value={editingProduct.barcode || ''} onChange={(val) => setEditingProduct({ ...editingProduct, barcode: val })} placeholder="Scan or enter barcode" />
              </FormField>
            </div>
            <FormField label="Name" required>
              <InputField value={editingProduct.name} onChange={(val) => setEditingProduct({ ...editingProduct, name: val })} placeholder="e.g. ThinkPad X1 Carbon" />
            </FormField>
            <FormField label="Description">
              <textarea
                className="form-textarea"
                rows={3}
                value={editingProduct.description || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                placeholder="Detailed product description..."
              />
            </FormField>
            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <FormField label="Category">
                <select
                  className="form-select"
                  value={editingProduct.category_id || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, category_id: e.target.value })}
                >
                  <option value="">No Category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Brand">
                <select
                  className="form-select"
                  value={editingProduct.brand_id || ''}
                  onChange={(e) => setEditingProduct({ ...editingProduct, brand_id: e.target.value })}
                >
                  <option value="">No Brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
              <FormField label="Cost Price ($)" required>
                <InputField type="number" step="0.01" min="0" value={editingProduct.cost_price} onChange={(val) => setEditingProduct({ ...editingProduct, cost_price: parseFloat(val) })} />
              </FormField>
              <FormField label="Selling Price ($)" required>
                <InputField type="number" step="0.01" min="0" value={editingProduct.selling_price} onChange={(val) => setEditingProduct({ ...editingProduct, selling_price: parseFloat(val) })} />
              </FormField>
            </div>
            <FormField label="Reorder Level (Units)" required>
              <InputField type="number" min="0" value={editingProduct.reorder_level} onChange={(val) => setEditingProduct({ ...editingProduct, reorder_level: parseInt(val, 10) })} />
            </FormField>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setIsEditOpen(false); setEditingProduct(null); }}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </Modal>
      )}

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
                value={newProduct.categoryId}
                onChange={(val) => setNewProduct((prev) => ({ ...prev, categoryId: val }))}
                options={categories.map(c => ({ value: c.id, label: c.name }))}
                placeholder="Select Category"
              />
            </FormField>
            <FormField label="Brand">
              <SearchableSelect
                value={newProduct.brandId}
                onChange={(val) => setNewProduct((prev) => ({ ...prev, brandId: val }))}
                options={brands.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Select Brand"
              />
            </FormField>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginTop: '10px' }}>
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
            <InputField
              label="Reorder Level *"
              id="reorderLevel"
              type="number"
              value={newProduct.reorderLevel}
              onChange={(val) => setNewProduct((prev) => ({ ...prev, reorderLevel: Number(val) }))}
              required
            />
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
