import { useEffect, useRef, useState, useCallback } from 'react';
import { Search, X } from 'lucide-react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
  id?: string;
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  debounceMs = 300,
  id = 'search-input',
}: SearchInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = useCallback(
    (newValue: string) => {
      setLocalValue(newValue);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(newValue), debounceMs);
    },
    [onChange, debounceMs]
  );

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="search-input" id={id}>
      <Search size={16} className="search-input__icon" />
      <input
        type="text"
        value={localValue}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="search-input__field"
        id={`${id}-field`}
      />
      {localValue && (
        <button
          type="button"
          className="search-input__clear"
          onClick={() => handleChange('')}
          aria-label="Clear search"
          id={`${id}-clear`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
