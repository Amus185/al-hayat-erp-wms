import { useState, useRef, useEffect } from 'react';
import { ChevronDown, X, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  style?: React.CSSProperties;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select option...',
  disabled = false,
  id,
  style,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => o.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter((o) => {
    const term = search.toLowerCase();
    return (
      o.label.toLowerCase().includes(term) ||
      (o.sublabel && o.sublabel.toLowerCase().includes(term))
    );
  });

  return (
    <div
      ref={containerRef}
      id={id}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      {/* Target input trigger */}
      <div
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          background: disabled ? '#f5f7f5' : '#ffffff',
          border: isOpen ? '1px solid #066006' : '1px solid #d9e2d9',
          borderRadius: '8px',
          boxShadow: isOpen ? '0 0 0 3px rgba(6, 96, 6, 0.12)' : 'none',
          cursor: disabled ? 'not-allowed' : 'pointer',
          minHeight: '38px',
          transition: 'all 0.15s ease',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            color: selectedOption ? '#1a201a' : '#889388',
            fontSize: '14px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            marginRight: '8px',
          }}
        >
          {selectedOption ? (
            <span>
              <strong>{selectedOption.label}</strong>
              {selectedOption.sublabel && (
                <span style={{ color: '#667066', marginLeft: '6px', fontSize: '12px' }}>
                  ({selectedOption.sublabel})
                </span>
              )}
            </span>
          ) : (
            placeholder
          )}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: '#667066' }}>
          {value && !disabled && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
                setSearch('');
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2px',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              <X size={14} />
            </span>
          )}
          <ChevronDown size={16} style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }} />
        </div>
      </div>

      {/* Popover Dropdown menu */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: '#ffffff',
            border: '1px solid #d9e2d9',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
            zIndex: 999,
            overflow: 'hidden',
            animation: 'fadeIn 0.15s ease',
          }}
        >
          {/* Search box inside dropdown */}
          <div style={{ padding: '8px', borderBottom: '1px solid #edf1ed', background: '#fafcf9' }}>
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                width: '100%',
                padding: '6px 10px',
                border: '1px solid #d9e2d9',
                borderRadius: '6px',
                fontSize: '13px',
                outline: 'none',
                background: '#ffffff',
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          {/* Options list */}
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <div
                    key={opt.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(opt.value);
                      setIsOpen(false);
                      setSearch('');
                    }}
                    style={{
                      padding: '9px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      fontSize: '13px',
                      background: isSelected ? '#e9f6e8' : 'transparent',
                      color: isSelected ? '#066006' : '#1a201a',
                      fontWeight: isSelected ? 600 : 400,
                      borderBottom: '1px solid #f4f6f4',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#f5f7f5';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div>
                      <span>{opt.label}</span>
                      {opt.sublabel && (
                        <span style={{ color: '#667066', marginLeft: '6px', fontSize: '12px', fontWeight: 400 }}>
                          ({opt.sublabel})
                        </span>
                      )}
                    </div>
                    {isSelected && <Check size={14} style={{ color: '#066006' }} />}
                  </div>
                );
              })
            ) : (
              <div style={{ padding: '12px', textAlign: 'center', color: '#889388', fontSize: '13px' }}>
                No options match your search
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
