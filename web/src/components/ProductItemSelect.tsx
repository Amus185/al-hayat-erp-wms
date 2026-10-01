import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X, Package, Check, Plus } from 'lucide-react';

export interface SelectableProduct {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  price?: number | null;
  priceLabel?: string;
  category?: string | null;
  stock?: number | null;
  stockHint?: string | null;
  stockWarning?: boolean;
}

interface ProductItemSelectProps {
  products: SelectableProduct[];
  onSelect: (product: SelectableProduct) => void;
  placeholder?: string;
  priceLabel?: string;
  existingLines?: { productId: string; quantity?: number }[];
  id?: string;
}

export function ProductItemSelect({
  products,
  onSelect,
  placeholder = 'Search or click to select product to add...',
  priceLabel = 'Price',
  existingLines = [],
  id = 'product-item-select',
}: ProductItemSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter products
  const q = search.trim().toLowerCase();
  const filteredProducts = products.filter((p) => {
    if (!q) return true;
    const nameMatch = p.name && p.name.toLowerCase().includes(q);
    const skuMatch = p.sku && String(p.sku).toLowerCase().includes(q);
    const barcodeMatch = p.barcode && String(p.barcode).toLowerCase().includes(q);
    const catMatch = p.category && String(p.category).toLowerCase().includes(q);
    return nameMatch || skuMatch || barcodeMatch || catMatch;
  });

  // Reset highlighted index on filter change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [search]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = (product: SelectableProduct) => {
    onSelect(product);
    setSearch('');
    setIsOpen(false);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev < filteredProducts.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredProducts[highlightedIndex]) {
        handleSelect(filteredProducts[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} id={id} style={{ position: 'relative', width: '100%' }}>
      {/* Trigger & Search Input */}
      <div
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: '#ffffff',
          border: isOpen ? '1px solid #066006' : '1px solid #d9e2d9',
          borderRadius: '8px',
          boxShadow: isOpen ? '0 0 0 3px rgba(6, 96, 6, 0.12)' : 'none',
          padding: '0 12px',
          height: '42px',
          cursor: 'text',
          transition: 'all 0.15s ease',
        }}
      >
        <Search size={16} style={{ color: isOpen ? '#066006' : '#9ca3af', flexShrink: 0 }} />

        <input
          ref={inputRef}
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            if (!isOpen) setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: '14px',
            color: '#0f172a',
            padding: 0,
            width: '100%',
          }}
        />

        {search && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSearch('');
              inputRef.current?.focus();
            }}
            style={{
              background: 'none',
              border: 'none',
              padding: '2px',
              cursor: 'pointer',
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}

        <div
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen(!isOpen);
            if (!isOpen) inputRef.current?.focus();
          }}
          style={{
            color: '#64748b',
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          <ChevronDown
            size={16}
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.15s ease',
            }}
          />
        </div>
      </div>

      {/* Popover Dropdown */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: '#ffffff',
            border: '1px solid #d9e2d9',
            borderRadius: '10px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
            zIndex: 100,
            overflow: 'hidden',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          {/* Header Bar */}
          <div
            style={{
              padding: '8px 14px',
              background: '#f8faf8',
              borderBottom: '1px solid #edf1ed',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '12px',
              color: '#64748b',
            }}
          >
            <span>
              {q
                ? `Matching "${search}" (${filteredProducts.length} product${filteredProducts.length !== 1 ? 's' : ''})`
                : `All Catalog Products (${products.length})`}
            </span>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Press ↵ Enter or click to add
            </span>
          </div>

          {/* Products List */}
          <div
            ref={listRef}
            style={{
              maxHeight: '320px',
              overflowY: 'auto',
            }}
          >
            {filteredProducts.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '13px',
                }}
              >
                <Package size={28} style={{ margin: '0 auto 8px', color: '#cbd5e1' }} />
                <p style={{ margin: 0, fontWeight: 500 }}>No matching products found</p>
                <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                  Check SKU, barcode, or name
                </p>
              </div>
            ) : (
              filteredProducts.map((p, index) => {
                const isHighlighted = index === highlightedIndex;
                const existing = existingLines.find((l) => l.productId === p.id);

                return (
                  <div
                    key={p.id}
                    onClick={() => handleSelect(p)}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    style={{
                      padding: '10px 14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #f1f5f1',
                      background: isHighlighted ? '#eef8ee' : '#ffffff',
                      transition: 'background 0.1s ease',
                    }}
                  >
                    {/* Left: Info */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <div
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '6px',
                          background: isHighlighted ? '#d7f0d7' : '#f1f5f9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#066006',
                          flexShrink: 0,
                        }}
                      >
                        <Package size={16} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: '13px',
                            color: '#0f172a',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            gap: '6px',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            marginTop: '2px',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'monospace',
                              fontSize: '11px',
                              padding: '1px 5px',
                              borderRadius: '4px',
                              background: '#f1f5f9',
                              color: '#475569',
                              fontWeight: 600,
                            }}
                          >
                            {p.sku}
                          </span>
                          {p.barcode && (
                            <span style={{ fontSize: '11px', color: '#64748b' }}>
                              Barcode: {p.barcode}
                            </span>
                          )}
                          {p.category && (
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                              • {p.category}
                            </span>
                          )}
                        </div>

                        {/* Stock & Location Guidance Hint */}
                        {(p.stock !== undefined || p.stockHint) && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}>
                            {p.stock !== undefined && (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  background: (p.stock ?? 0) > 0 ? '#ecfdf5' : '#fef2f2',
                                  color: (p.stock ?? 0) > 0 ? '#065f46' : '#991b1b',
                                  border: (p.stock ?? 0) > 0 ? '1px solid #a7f3d0' : '1px solid #fecaca',
                                }}
                              >
                                {(p.stock ?? 0) > 0 ? `✓ ${p.stock} at branch` : '⚠ 0 at branch'}
                              </span>
                            )}
                            {p.stockHint && (
                              <span style={{ fontSize: '11px', color: (p.stock ?? 0) === 0 ? '#0369a1' : '#64748b', fontWeight: (p.stock ?? 0) === 0 ? 500 : 400 }}>
                                {p.stockHint}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right: Price & Status */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      {p.price !== undefined && p.price !== null && (
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: '11px', color: '#64748b', display: 'block' }}>
                            {p.priceLabel || priceLabel}
                          </span>
                          <span style={{ fontWeight: 700, fontSize: '13px', color: '#0b8f08' }}>
                            ${Number(p.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                      )}

                      {existing ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: '#dcfce7',
                            color: '#15803d',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                        >
                          <Check size={12} />
                          Added {existing.quantity ? `(${existing.quantity})` : ''}
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '3px 8px',
                            borderRadius: '6px',
                            background: isHighlighted ? '#066006' : '#f1f5f9',
                            color: isHighlighted ? '#ffffff' : '#475569',
                            fontSize: '11px',
                            fontWeight: 600,
                            transition: 'all 0.1s ease',
                          }}
                        >
                          <Plus size={12} />
                          Add
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
