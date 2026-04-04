import clsx from 'clsx';
import styles from './Dropdown.module.css';

export interface DropdownOption {
  label: string;
  value: string;
}

export interface DropdownProps {
  value: string;
  onChange: (value: string) => void;
  options: DropdownOption[];
  disabled?: boolean;
  label?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  size?: 'small' | 'medium' | 'large';
}

export function Dropdown({
  value,
  onChange,
  options,
  disabled = false,
  label,
  id,
  className,
  placeholder,
  size = 'medium',
}: DropdownProps) {
  const selectId = id || `dropdown-${Math.random().toString(36).slice(2, 8)}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  const selectClasses = clsx(
    styles.dropdown,
    styles[`dropdown${size.charAt(0).toUpperCase()}${size.slice(1)}`],
    className
  );

  const selectElement = (
    <select
      id={selectId}
      className={selectClasses}
      value={value}
      onChange={handleChange}
      disabled={disabled}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  if (!label) {
    return selectElement;
  }

  return (
    <div className={styles.dropdownGroup}>
      <label className={styles.dropdownLabel} htmlFor={selectId}>
        {label}
      </label>
      {selectElement}
    </div>
  );
}
