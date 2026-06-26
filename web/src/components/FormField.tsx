import type { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}

export function FormField({ label, htmlFor, error, required, children }: FormFieldProps) {
  return (
    <div className={`form-field ${error ? 'form-field--error' : ''}`}>
      <label className="form-field__label" htmlFor={htmlFor}>
        {label}
        {required && <span className="form-field__required">*</span>}
      </label>
      {children}
      {error && <span className="form-field__error">{error}</span>}
    </div>
  );
}

// Convenience input components
interface InputFieldProps {
  label: string;
  id: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'date';
  value: string | number;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  step?: number;
}

export function InputField({
  label,
  id,
  type = 'text',
  value,
  onChange,
  error,
  required,
  placeholder,
  disabled,
  min,
  step,
}: InputFieldProps) {
  return (
    <FormField label={label} htmlFor={id} error={error} required={required}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-input"
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        min={min}
        step={step}
      />
    </FormField>
  );
}

interface SelectFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

export function SelectField({
  label,
  id,
  value,
  onChange,
  options,
  error,
  required,
  placeholder,
  disabled,
}: SelectFieldProps) {
  return (
    <FormField label={label} htmlFor={id} error={error} required={required}>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-select"
        disabled={disabled}
        required={required}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

interface TextareaFieldProps {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}

export function TextareaField({
  label,
  id,
  value,
  onChange,
  error,
  required,
  placeholder,
  rows = 3,
  disabled,
}: TextareaFieldProps) {
  return (
    <FormField label={label} htmlFor={id} error={error} required={required}>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="form-textarea"
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        required={required}
      />
    </FormField>
  );
}
