import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: Option[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function SearchableSelect({ options, value, onChange, placeholder = "Select...", disabled = false }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Find the selected option's label to display when closed
  const selectedOption = options.find(opt => opt.value === value);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width: '100%' }}>
      <div 
        className="form-control"
        style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          cursor: disabled ? 'not-allowed' : 'pointer', 
          backgroundColor: disabled ? '#f8fafc' : '#fff', 
          userSelect: 'none',
          padding: '10px 14px',
          border: '1px solid #cbd5e1',
          borderRadius: '6px',
          opacity: disabled ? 0.7 : 1
        }}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setSearchTerm('');
          }
        }}
      >
        <span style={{ color: selectedOption ? '#0f172a' : '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={18} color="#64748b" style={{ flexShrink: 0, marginLeft: '8px', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
      </div>

      {isOpen && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          marginTop: '4px',
          backgroundColor: '#fff',
          border: '1px solid #e1e8e1',
          borderRadius: '8px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
          zIndex: 50,
          maxHeight: '300px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #e1e8e1', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Search size={16} color="#64748b" />
            <input 
              autoFocus
              type="text" 
              placeholder="Type to search..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                fontSize: '14px',
                padding: '4px 0',
                backgroundColor: 'transparent',
                color: '#0f172a'
              }}
            />
          </div>
          <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((opt) => (
                <div 
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    backgroundColor: opt.value === value ? '#f0fdf4' : 'transparent',
                    color: opt.value === value ? '#066006' : '#334155',
                    fontSize: '14px',
                    transition: 'background-color 0.1s'
                  }}
                  onMouseEnter={(e) => {
                    if (opt.value !== value) e.currentTarget.style.backgroundColor = '#f8fafc';
                  }}
                  onMouseLeave={(e) => {
                    if (opt.value !== value) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {opt.label}
                </div>
              ))
            ) : (
              <div style={{ padding: '16px', color: '#64748b', fontSize: '14px', textAlign: 'center' }}>
                No results found for "{searchTerm}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
