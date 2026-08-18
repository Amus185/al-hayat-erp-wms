import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PackageSearch, Plus, Trash2, List, Settings, PlusCircle, Loader2, Upload, Download, FileSpreadsheet, CheckCircle, AlertCircle, X, RefreshCw } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, apiDownload } from '../api/client';
import { getCached, setCached } from '../api/cache';
import { DataTable, type Column } from '../components/DataTable';
import { SearchInput } from '../components/SearchInput';
import { FilterBar } from '../components/FilterBar';
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
  barcode?: string;
  name: string;
  description?: string;
  category_id: string | null;
  brand_id: string | null;
  cost_price: number;
  selling_price: number;
  reorder_level: number;
  is_active: boolean;
  category_name?: string;
  brand_name?: string;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { hasPermission } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [warehouses, setWarehouses] = useState<{ id: string; name: string }[]>([]);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string>>({ category: '', brand: '', status: '' });

  const handleFilterChange = (key: string, value: string) => {
    setFilterValues(prev => ({ ...prev, [key]: value }));
  };

  // Modals state
  const [submitting, setSubmitting] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Inline Category Creation Modal
  const [isInlineCategoryOpen, setIsInlineCategoryOpen] = useState(false);
  const [inlineCategoryName, setInlineCategoryName] = useState('');

  // Bulk Product Import Modal
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<any[]>([]);
  const [bulkFileName, setBulkFileName] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetBulkUpload = () => {
    setBulkRows([]);
    setBulkFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
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
    totalOpeningStock: 0,
  });

  // Multi-location initial stock lines
  interface StockLine {
    id: number;
    ownerType: 'WAREHOUSE' | 'BRANCH';
    locationId: string;
    quantity: number;
  }
  const [initialStockLines, setInitialStockLines] = useState<StockLine[]>([]);

  const addStockLine = (qty = 0) => {
    setInitialStockLines(prev => [
      ...prev,
      { id: Date.now() + Math.random(), ownerType: 'WAREHOUSE', locationId: '', quantity: qty }
    ]);
  };

  const removeStockLine = (id: number) => {
    setInitialStockLines(prev => prev.filter(l => l.id !== id));
  };

  const updateStockLine = (id: number, patch: Partial<StockLine>) => {
    setInitialStockLines(prev =>
      prev.map(l => (l.id === id ? { ...l, ...patch } : l))
    );
  };

  // Helper metrics for allocation calculations
  const totalAllocated = initialStockLines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  const totalOpening = Number(newProduct.totalOpeningStock || 0);
  const remainingToAllocate = totalOpening - totalAllocated;

  // Split total stock equally across all location lines
  const handleSplitEqually = () => {
    if (initialStockLines.length === 0 || totalOpening <= 0) return;
    const baseQty = Math.floor(totalOpening / initialStockLines.length);
    let remainder = totalOpening - (baseQty * initialStockLines.length);

    setInitialStockLines(prev =>
      prev.map((line, idx) => {
        const qty = baseQty + (idx < remainder ? 1 : 0);
        return { ...line, quantity: qty };
      })
    );
  };

  // Fill remaining unallocated stock into a new or empty location row
  const handleFillRemaining = () => {
    if (remainingToAllocate <= 0) return;
    addStockLine(remainingToAllocate);
  };

  const openEditModal = (prod: Product) => {
    setEditingProduct({ ...prod, is_active: prod.is_active !== undefined ? prod.is_active : 1 });
    setIsEditOpen(true);
  };

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
    const cached = getCached<Product[]>('products:list');
    if (cached) {
      setProducts(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      const prs = await apiGet<Product[]>('/products');
      const rows = prs || [];
      setCached('products:list', rows);
      setProducts(rows);
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    fetchFilters();
    Promise.all([
      apiGet<{ id: string; name: string }[]>('/warehouses'),
      apiGet<{ id: string; name: string }[]>('/branches'),
    ]).then(([whs, brs]) => {
      setWarehouses(whs || []);
      setBranches(brs || []);
    }).catch(console.error);
  }, []);

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

  // Inline Category Creation Handler
  const handleCreateInlineCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inlineCategoryName || !inlineCategoryName.trim()) return;
    try {
      setSubmitting(true);
      const created = await apiPost<any>('/products/categories', { name: inlineCategoryName.trim() });
      addToast('success', `Category "${created.name}" created`);
      setInlineCategoryName('');
      setIsInlineCategoryOpen(false);
      await fetchFilters();
      setNewProduct(prev => ({ ...prev, categoryId: created.id }));
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create category');
    } finally {
      setSubmitting(false);
    }
  };

  // CSV Template Downloader
  const handleDownloadTemplate = () => {
    const csvContent =
      "SKU,Barcode,Name,Description,Category,Brand,CostPrice,SellingPrice,ReorderLevel,InitialStock,LocationType,LocationName\n" +
      "FUR-001,8901001,Executive Desk 180cm,Ergonomic office desk,Office Furniture,AlHayat,250,400,5,10,WAREHOUSE,Central Warehouse\n" +
      "CHAIR-001,8901002,Ergonomic Mesh Chair,Breathable mesh chair,Office Furniture,AlHayat,80,150,10,25,BRANCH,Calaamad Showroom\n";

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'product_import_template.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Client-side CSV Parser
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (!text) return;
      const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
      if (lines.length < 2) {
        addToast('error', 'CSV file must contain a header row and at least 1 data row.');
        return;
      }

      const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
      const parsedRows: any[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
        const getVal = (colName: string, altIdx: number) => {
          const idx = headers.findIndex(h => h.toLowerCase() === colName.toLowerCase());
          return idx !== -1 ? values[idx] || '' : values[altIdx] || '';
        };

        const sku = getVal('SKU', 0);
        const name = getVal('Name', 2);
        if (!sku || !name) continue;

        parsedRows.push({
          sku,
          barcode: getVal('Barcode', 1),
          name,
          description: getVal('Description', 3),
          categoryName: getVal('Category', 4),
          brandName: getVal('Brand', 5),
          costPrice: Number(getVal('CostPrice', 6) || 0),
          sellingPrice: Number(getVal('SellingPrice', 7) || 0),
          reorderLevel: Number(getVal('ReorderLevel', 8) || 5),
          initialStock: Number(getVal('InitialStock', 9) || 0),
          locationType: (getVal('LocationType', 10) || 'WAREHOUSE').toUpperCase(),
          locationName: getVal('LocationName', 11),
        });
      }

      setBulkRows(parsedRows);
      if (parsedRows.length === 0) {
        addToast('warning', 'No valid product rows found in CSV file.');
      } else {
        addToast('info', `Loaded ${parsedRows.length} product(s) from CSV`);
      }
    };
    reader.readAsText(file);
  };

  // Bulk Submit Handler
  const handleBulkSubmit = async () => {
    if (bulkRows.length === 0) return;
    try {
      setBulkSubmitting(true);
      const res: any = await apiPost('/products/bulk', { products: bulkRows });
      if (res?.skipped && res.skipped.length > 0) {
        addToast('warning', `Imported ${res.created || 0} products. ${res.skipped.length} product(s) skipped due to duplicate barcodes/SKUs.`);
      } else {
        addToast('success', `🎉 Successfully imported ${res?.created || res?.count || bulkRows.length} products!`);
      }
      setIsBulkModalOpen(false);
      resetBulkUpload();
      loadData();
      fetchFilters();
    } catch (err: any) {
      addToast('error', err?.message || 'Bulk import failed');
    } finally {
      setBulkSubmitting(false);
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

    // Strict 100% location allocation validation
    if (totalOpening > 0) {
      if (totalAllocated !== totalOpening) {
        addToast(
          'error',
          `Stock allocation mismatch: Total Opening Stock is ${totalOpening} units, but ${totalAllocated} units are assigned to locations. Please assign all ${totalOpening} units.`
        );
        return;
      }
      const unassigned = initialStockLines.filter(l => !l.locationId);
      if (unassigned.length > 0) {
        addToast('error', 'Please select a location for all stock rows.');
        return;
      }
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
      setSubmitting(true);
      const created: any = await apiPost('/products', payload);

      // Distribute initial stock across multiple locations in parallel
      const validLines = initialStockLines.filter(l => l.locationId && l.quantity > 0);
      if (validLines.length > 0) {
        const stockResults = await Promise.allSettled(
          validLines.map(line =>
            apiPost('/inventory/adjust', {
              productId: created.id,
              direction: 'INCREASE',
              quantity: line.quantity,
              ownerType: line.ownerType,
              ...(line.ownerType === 'WAREHOUSE'
                ? { warehouseId: line.locationId }
                : { branchId: line.locationId }),
              notes: 'Initial stock on product creation',
            })
          )
        );
        const failed = stockResults.filter(r => r.status === 'rejected').length;
        if (failed > 0) {
          addToast('error', `Product created, but ${failed} stock location(s) failed — check Inventory manually.`);
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
      setInitialStockLines([]);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to create product');
    } finally {
      setSubmitting(false);
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
    if (!editingProduct || submitting) return;

    if (editingProduct.cost_price > editingProduct.selling_price) {
      addToast('error', 'Cost Price cannot be greater than Selling Price');
      return;
    }

    try {
      setSubmitting(true);
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
        isActive: editingProduct.is_active !== undefined ? (editingProduct.is_active ? 1 : 0) : 1,
      });

      addToast('success', 'Product updated successfully');
      setIsEditOpen(false);
      setEditingProduct(null);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update product');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (prod: Product, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextStatus = prod.is_active ? 0 : 1;
    try {
      await apiPatch(`/products/${prod.id}/status`, { is_active: nextStatus });
      addToast('success', `Product "${prod.name}" ${nextStatus ? 'activated' : 'deactivated'}`);
      loadData();
    } catch (err: any) {
      addToast('error', err?.message || 'Failed to update status');
    }
  };

  const filteredProducts = products.filter((p) => {
    const q = search.trim().toLowerCase();
    if (
      q &&
      !String(p.name || '').toLowerCase().includes(q) &&
      !String(p.sku || '').toLowerCase().includes(q) &&
      !String(p.barcode || '').toLowerCase().includes(q)
    ) return false;
    if (filterValues.category && p.category_id !== filterValues.category) return false;
    if (filterValues.brand && p.brand_id !== filterValues.brand) return false;
    if (filterValues.status === 'active' && !p.is_active) return false;
    if (filterValues.status === 'inactive' && p.is_active) return false;
    return true;
  });

  const columns: Column<Product>[] = [
    { key: 'sku', label: 'Product ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category_name', label: 'Category', render: (row) => row.category_name || 'N/A' },
    { key: 'brand_name', label: 'Brand', render: (row) => row.brand_name || 'N/A' },
    { key: 'cost_price', label: 'Cost Price', render: (row) => `$${Number(row.cost_price).toLocaleString()}` },
    { key: 'selling_price', label: 'Selling Price', render: (row) => `$${Number(row.selling_price).toLocaleString()}` },
    {
      key: 'status',
      label: 'Status',
      render: (row) => (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 700,
            background: row.is_active ? '#ecfdf5' : '#f3f4f6',
            color: row.is_active ? '#065f46' : '#6b7280',
            border: `1px solid ${row.is_active ? '#a7f3d0' : '#d1d5db'}`,
          }}
        >
          {row.is_active ? '● Active' : '○ Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (row) => (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(e) => {
                e.stopPropagation();
                openEditModal(row);
              }}
              style={{ fontSize: '11px', padding: '3px 8px' }}
            >
              Edit
            </button>
          )}
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={(e) => handleToggleStatus(row, e)}
              style={{
                fontSize: '11px',
                padding: '3px 8px',
                color: row.is_active ? '#b45309' : '#065f46',
              }}
              title={row.is_active ? 'Deactivate Product' : 'Activate Product'}
            >
              {row.is_active ? 'Deactivate' : 'Activate'}
            </button>
          )}
          {hasPermission('manage_inventory') && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={(e) => handleDelete(row.id, e)}
              style={{ padding: '3px 6px' }}
              title="Delete Product"
            >
              <Trash2 size={13} />
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
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                resetBulkUpload();
                setIsBulkModalOpen(true);
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Upload size={16} /> Bulk Import
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

      <section className="panel">
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search by Product ID, Name…"
          filters={[
            {
              key: 'category',
              label: 'All Categories',
              options: categories.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              key: 'brand',
              label: 'All Brands',
              options: brands.map((b) => ({ value: b.id, label: b.name })),
            },
            {
              key: 'status',
              label: 'All Statuses',
              options: [
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ],
            },
          ]}
          filterValues={filterValues}
          onFilterChange={handleFilterChange}
        />
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
              <div style={{ display: 'flex', gap: '6px' }}>
                <div style={{ flex: 1 }}>
                  <SearchableSelect
                    options={categories.map((c) => ({ value: c.id, label: c.name }))}
                    value={newProduct.categoryId}
                    onChange={(val) => setNewProduct((prev) => ({ ...prev, categoryId: val }))}
                    placeholder="Search Category..."
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsInlineCategoryOpen(true)}
                  style={{ padding: '0 10px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700 }}
                  title="Add New Category"
                >
                  <Plus size={14} /> New
                </button>
              </div>
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

          {/* Initial Stock Section — Multi-location */}
          <div style={{ marginTop: '16px', padding: '16px', background: '#f4fbf4', borderRadius: '10px', border: '1px solid #d1e8d1' }}>
            <div style={{ marginBottom: '14px' }}>
              <p style={{ margin: 0, fontWeight: 700, color: '#066006', fontSize: '14px' }}>📦 Initial Opening Stock (Optional)</p>
              <p style={{ margin: '3px 0 0', fontSize: '12px', color: '#667066' }}>Specify total opening units (e.g. 100, 1,000) and split them across warehouses & branches.</p>
            </div>

            {/* Total Opening Stock Input & Quick Presets */}
            <div style={{ background: '#fff', padding: '12px 14px', borderRadius: '8px', border: '1px solid #d9e8d9', marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#2d3748', marginBottom: '6px' }}>
                Total Opening Stock (Units)
              </label>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="number"
                  min={0}
                  placeholder="e.g. 1000"
                  value={newProduct.totalOpeningStock || ''}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, totalOpeningStock: Math.max(0, Number(e.target.value)) }))}
                  style={{ flex: 1, minWidth: '140px', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '14px', fontWeight: 600 }}
                />
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {[100, 500, 1000, 5000].map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNewProduct(prev => ({ ...prev, totalOpeningStock: preset }))}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: newProduct.totalOpeningStock === preset ? '#e6f4e6' : '#f8fafc',
                        color: newProduct.totalOpeningStock === preset ? '#066006' : '#475569',
                        fontWeight: newProduct.totalOpeningStock === preset ? 700 : 500,
                        fontSize: '12px',
                        cursor: 'pointer'
                      }}
                    >
                      +{preset.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Allocation Status Banner */}
            {totalOpening > 0 && (
              <div style={{
                padding: '10px 14px',
                borderRadius: '8px',
                marginBottom: '14px',
                fontSize: '13px',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
                background: totalAllocated === totalOpening ? '#f0fdf4' : remainingToAllocate > 0 ? '#fffbe6' : '#fef2f2',
                border: `1px solid ${totalAllocated === totalOpening ? '#bbf7d0' : remainingToAllocate > 0 ? '#ffe58f' : '#fecaca'}`,
                color: totalAllocated === totalOpening ? '#166534' : remainingToAllocate > 0 ? '#873800' : '#991b1b',
              }}>
                <div>
                  {totalAllocated === totalOpening && (
                    <span>🟢 <strong>100% Allocated</strong> ({totalAllocated.toLocaleString()} / {totalOpening.toLocaleString()} units assigned)</span>
                  )}
                  {remainingToAllocate > 0 && (
                    <span>🟡 <strong>Incomplete Allocation</strong>: {totalAllocated.toLocaleString()} / {totalOpening.toLocaleString()} assigned — <strong>{remainingToAllocate.toLocaleString()} units remaining</strong></span>
                  )}
                  {remainingToAllocate < 0 && (
                    <span>🔴 <strong>Over Allocated</strong>: {totalAllocated.toLocaleString()} assigned (exceeds total opening stock by {Math.abs(remainingToAllocate).toLocaleString()} units)</span>
                  )}
                </div>

                {/* Quick Helper Actions */}
                <div style={{ display: 'flex', gap: '8px' }}>
                  {initialStockLines.length > 1 && (
                    <button
                      type="button"
                      onClick={handleSplitEqually}
                      style={{ padding: '5px 10px', borderRadius: '6px', background: '#fff', border: '1px solid #cbd5e1', fontSize: '12px', fontWeight: 600, cursor: 'pointer', color: '#1e293b' }}
                    >
                      ⚡ Split Equally
                    </button>
                  )}
                  {remainingToAllocate > 0 && (
                    <button
                      type="button"
                      onClick={handleFillRemaining}
                      style={{ padding: '5px 10px', borderRadius: '6px', background: '#066006', color: '#fff', border: 'none', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                    >
                      ➕ Fill Remaining ({remainingToAllocate.toLocaleString()})
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Location Table Controls Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155' }}>
                Stock Locations ({initialStockLines.length})
              </span>
              <button
                type="button"
                onClick={() => addStockLine(remainingToAllocate > 0 ? remainingToAllocate : 0)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '6px 12px', background: '#066006', color: '#fff',
                  border: 'none', borderRadius: '7px', cursor: 'pointer',
                  fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap',
                }}
              >
                <PlusCircle size={14} /> Add Location
              </button>
            </div>

            {initialStockLines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '18px 0', color: '#889388', fontSize: '13px', border: '1px dashed #c8dcc8', borderRadius: '8px' }}>
                No stock locations added — click <strong>Add Location</strong> to assign opening stock.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '8px' }}>
                {/* Header row */}
                <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 100px 36px', gap: '8px', padding: '0 4px' }}>
                  <span style={{ fontSize: '11px', color: '#667066', fontWeight: 600, textTransform: 'uppercase' }}>Owner Type</span>
                  <span style={{ fontSize: '11px', color: '#667066', fontWeight: 600, textTransform: 'uppercase' }}>Location</span>
                  <span style={{ fontSize: '11px', color: '#667066', fontWeight: 600, textTransform: 'uppercase' }}>Qty</span>
                  <span></span>
                </div>

                {initialStockLines.map(line => (
                  <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '130px 1fr 100px 36px', gap: '8px', alignItems: 'center', background: '#fff', padding: '8px 10px', borderRadius: '8px', border: '1px solid #d9e8d9' }}>
                    {/* Owner type toggle */}
                    <select
                      className="form-select"
                      style={{ fontSize: '13px', padding: '6px 8px' }}
                      value={line.ownerType}
                      onChange={(e) => updateStockLine(line.id, { ownerType: e.target.value as any, locationId: '' })}
                    >
                      <option value="WAREHOUSE">Warehouse</option>
                      <option value="BRANCH">Branch</option>
                    </select>

                    {/* Location picker */}
                    <SearchableSelect
                      options={
                        line.ownerType === 'WAREHOUSE'
                          ? warehouses.map(w => ({ value: w.id, label: w.name }))
                          : branches.map(b => ({ value: b.id, label: b.name }))
                      }
                      value={line.locationId}
                      onChange={(val) => updateStockLine(line.id, { locationId: val })}
                      placeholder={line.ownerType === 'WAREHOUSE' ? 'Select Warehouse...' : 'Select Branch...'}
                    />

                    {/* Quantity */}
                    <input
                      type="number"
                      min={0}
                      value={line.quantity}
                      onChange={(e) => updateStockLine(line.id, { quantity: Number(e.target.value) })}
                      style={{ width: '100%', padding: '6px 8px', border: '1px solid #d9e2d9', borderRadius: '8px', fontSize: '13px' }}
                    />

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => removeStockLine(line.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cc3333', padding: '4px', display: 'flex', alignItems: 'center' }}
                      title="Remove row"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                {/* Totals footer */}
                {initialStockLines.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px', borderTop: '1px solid #d1e8d1', marginTop: '4px' }}>
                    <span style={{ fontSize: '13px', color: '#066006', fontWeight: 700 }}>
                      Total Opening Stock: {initialStockLines.reduce((sum, l) => sum + (l.quantity || 0), 0)} units
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsCreateOpen(false)} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
              {submitting ? (
                <><Loader2 size={14} className="spin-icon" /> Creating Product…</>
              ) : (
                'Create Product'
              )}
            </button>
          </div>
        </form>
      </Modal>

      {/* Edit Product Modal */}
      {isEditOpen && editingProduct && (
        <Modal isOpen={isEditOpen} title="Edit Product" onClose={() => { setIsEditOpen(false); setEditingProduct(null); }} width="md">
          <form onSubmit={handleEditProduct}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <InputField label="Product ID (SKU) *" id="editSku" value={editingProduct.sku} onChange={(val) => setEditingProduct({ ...editingProduct, sku: val })} required />
              <InputField label="Barcode *" id="editBarcode" value={editingProduct.barcode || ''} onChange={(val) => setEditingProduct({ ...editingProduct, barcode: val })} required />
            </div>
            <div style={{ marginTop: '10px' }}>
              <InputField label="Product Name *" id="editName" value={editingProduct.name} onChange={(val) => setEditingProduct({ ...editingProduct, name: val })} required />
            </div>
            <div style={{ marginTop: '10px' }}>
              <label className="form-field__label">Description</label>
              <textarea
                className="form-textarea"
                rows={2}
                value={editingProduct.description || ''}
                onChange={(e) => setEditingProduct({ ...editingProduct, description: e.target.value })}
                placeholder="Detailed product description..."
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '10px' }}>
              <FormField label="Category">
                <div style={{ display: 'flex', gap: '6px' }}>
                  <div style={{ flex: 1 }}>
                    <SearchableSelect
                      options={categories.map((c) => ({ value: c.id, label: c.name }))}
                      value={editingProduct.category_id || ''}
                      onChange={(val) => setEditingProduct({ ...editingProduct, category_id: val })}
                      placeholder="Search Category..."
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsInlineCategoryOpen(true)}
                    style={{ padding: '0 10px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700 }}
                    title="Add New Category"
                  >
                    <Plus size={14} /> New
                  </button>
                </div>
              </FormField>

              <FormField label="Brand">
                <SearchableSelect
                  options={brands.map((b) => ({ value: b.id, label: b.name }))}
                  value={editingProduct.brand_id || ''}
                  onChange={(val) => setEditingProduct({ ...editingProduct, brand_id: val })}
                  placeholder="Search Brand..."
                />
              </FormField>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginTop: '10px' }}>
              <InputField type="number" label="Cost Price ($) *" id="editCost" value={editingProduct.cost_price.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, cost_price: parseFloat(val) || 0 })} required />
              <InputField type="number" label="Selling Price ($) *" id="editSell" value={editingProduct.selling_price.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, selling_price: parseFloat(val) || 0 })} required />
              <InputField type="number" label="Reorder Level *" id="editReorder" value={editingProduct.reorder_level.toString()} onChange={(val) => setEditingProduct({ ...editingProduct, reorder_level: parseInt(val, 10) || 0 })} required />
            </div>

            <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <input
                type="checkbox"
                id="editIsActive"
                checked={editingProduct.is_active !== 0}
                onChange={(e) => setEditingProduct({ ...editingProduct, is_active: e.target.checked ? 1 : 0 })}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="editIsActive" style={{ fontSize: '13px', fontWeight: 600, color: '#1e293b', cursor: 'pointer' }}>
                Active Product (Available in Catalog & Sales)
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '20px' }}>
              <button type="button" className="btn btn-secondary" onClick={() => { setIsEditOpen(false); setEditingProduct(null); }} disabled={submitting}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting} style={{ display: 'flex', alignItems: 'center' }}>
                {submitting ? (
                  <><Loader2 size={14} className="spin-icon" /> Saving Changes…</>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Inline Category Creation Modal */}
      <Modal isOpen={isInlineCategoryOpen} onClose={() => setIsInlineCategoryOpen(false)} title="Add New Category">
        <form onSubmit={handleCreateInlineCategory} style={{ display: 'grid', gap: '14px' }}>
          <InputField
            label="Category Name *"
            id="inlineCatName"
            value={inlineCategoryName}
            onChange={setInlineCategoryName}
            placeholder="e.g. Office Furniture, Lamps, Hardware..."
            required
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setIsInlineCategoryOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save & Select'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bulk Product Import Modal */}
      <Modal
        isOpen={isBulkModalOpen}
        onClose={() => {
          setIsBulkModalOpen(false);
          resetBulkUpload();
        }}
        title="Bulk Import Products (CSV / Excel)"
        width="lg"
      >
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: '#1e293b' }}>1. Download Import Template</p>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#64748b' }}>Includes sample headers: SKU, Barcode, Name, Description, Category, Brand, Cost, Selling Price, Initial Stock.</p>
            </div>
            <button type="button" onClick={handleDownloadTemplate} className="btn btn-secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Download size={15} /> Download CSV Template
            </button>
          </div>

          <div style={{ background: '#fff', border: '2px dashed #cbd5e1', borderRadius: '10px', padding: '20px', textAlign: 'center', position: 'relative' }}>
            <FileSpreadsheet size={32} color="#065f46" style={{ marginBottom: '8px' }} />
            <p style={{ margin: 0, fontWeight: 700, fontSize: '14px', color: '#334155' }}>2. Upload CSV File</p>
            <p style={{ margin: '4px 0 12px', fontSize: '12px', color: '#64748b' }}>Select your CSV file to preview products before importing.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ fontSize: '13px' }}
            />
            {bulkFileName && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '10px' }}>
                <span style={{ fontSize: '12px', fontWeight: 600, color: '#066006', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '4px 10px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  📄 {bulkFileName}
                  <button
                    type="button"
                    onClick={resetBulkUpload}
                    style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', padding: '2px', marginLeft: '4px' }}
                    title="Remove file"
                  >
                    <X size={14} />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={resetBulkUpload}
                  style={{
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    fontSize: '11px',
                    fontWeight: 600,
                    padding: '4px 8px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Trash2 size={12} /> Clear File
                </button>
              </div>
            )}
          </div>

          {bulkRows.length > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: '#065f46' }}>
                  🟢 Preview Products Ready ({bulkRows.length} items)
                </span>
                <button
                  type="button"
                  onClick={resetBulkUpload}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#dc2626',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: '4px 10px',
                    borderRadius: '6px'
                  }}
                  title="Clear previewed products"
                >
                  <Trash2 size={13} /> Clear Preview
                </button>
              </div>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                  <thead>
                    <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                      <th style={{ padding: '8px 10px' }}>SKU</th>
                      <th style={{ padding: '8px 10px' }}>Name</th>
                      <th style={{ padding: '8px 10px' }}>Category</th>
                      <th style={{ padding: '8px 10px' }}>Cost</th>
                      <th style={{ padding: '8px 10px' }}>Selling</th>
                      <th style={{ padding: '8px 10px' }}>Opening Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkRows.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 700 }}>{r.sku}</td>
                        <td style={{ padding: '6px 10px' }}>{r.name}</td>
                        <td style={{ padding: '6px 10px' }}>{r.categoryName || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>${r.costPrice}</td>
                        <td style={{ padding: '6px 10px' }}>${r.sellingPrice}</td>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: '#066006' }}>{r.initialStock} units ({r.locationName || r.locationType})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setIsBulkModalOpen(false);
                resetBulkUpload();
              }}
              disabled={bulkSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleBulkSubmit}
              disabled={bulkSubmitting || bulkRows.length === 0}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              {bulkSubmitting ? <><Loader2 size={14} className="spin-icon" /> Importing…</> : `Import ${bulkRows.length} Product(s)`}
            </button>
          </div>
        </div>
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
