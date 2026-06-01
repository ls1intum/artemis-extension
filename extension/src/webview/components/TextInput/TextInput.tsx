import clsx from 'clsx';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import { KeyboardEvent, useState } from 'react';

import styles from './TextInput.module.css';

interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'password' | 'email' | 'url' | 'search' | 'tel' | 'number';
  label?: string;
  id?: string;
  className?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  autoFocus?: boolean;
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  size?: 'small' | 'medium' | 'large';
  fullWidth?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  readonly?: boolean;
  autocomplete?: string;
  showPasswordToggle?: boolean;
  testId?: string;
}

export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
  type = 'text',
  label,
  id,
  className,
  error,
  hint,
  required = false,
  autoFocus = false,
  onBlur,
  onFocus,
  onKeyDown,
  size = 'medium',
  fullWidth = false,
  maxLength,
  minLength,
  pattern,
  readonly = false,
  autocomplete = 'off',
  showPasswordToggle = true,
  testId,
}: TextInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  const inputId = id || `text-input-${Math.random().toString(36).slice(2, 8)}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  const inputClasses = clsx(
    styles.input,
    styles[`input${size.charAt(0).toUpperCase()}${size.slice(1)}`],
    {
      [styles.inputFullWidth]: fullWidth,
      [styles.inputError]: Boolean(error),
      [styles.inputDisabled]: disabled,
    },
    className
  );

  const isPasswordWithToggle = type === 'password' && showPasswordToggle;
  const actualInputType = isPasswordWithToggle && showPassword ? 'text' : type;

  const ariaDescribedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const inputElement = (
    <input
      id={inputId}
      type={actualInputType}
      className={inputClasses}
      value={value}
      onChange={handleChange}
      onBlur={() => onBlur?.()}
      onFocus={() => onFocus?.()}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      maxLength={maxLength}
      minLength={minLength}
      pattern={pattern}
      readOnly={readonly}
      autoComplete={autocomplete}
      aria-describedby={ariaDescribedBy}
      aria-invalid={Boolean(error)}
      data-testid={testId}
    />
  );

  if (!label && !error && !hint) {
    if (isPasswordWithToggle) {
      return (
        <div className={styles.inputPasswordWrapper}>
          {inputElement}
          <button
            type="button"
            className={styles.inputPasswordToggle}
            onClick={togglePasswordVisibility}
            aria-label="Toggle password visibility"
            tabIndex={-1}
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      );
    }
    return inputElement;
  }

  const labelElement = label ? (
    <label className={styles.inputLabel} htmlFor={inputId}>
      {label}
      {required && <span className={styles.inputRequired}>*</span>}
    </label>
  ) : null;

  const errorElement = error ? (
    <span id={errorId} className={styles.inputErrorMessage}>
      {error}
    </span>
  ) : null;

  const hintElement = !error && hint ? (
    <span id={hintId} className={styles.inputHelperText}>
      {hint}
    </span>
  ) : null;

  const inputWithToggle = isPasswordWithToggle ? (
    <div className={styles.inputPasswordWrapper}>
      {inputElement}
      <button
        type="button"
        className={styles.inputPasswordToggle}
        onClick={togglePasswordVisibility}
        aria-label="Toggle password visibility"
        tabIndex={-1}
      >
        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  ) : (
    inputElement
  );

  return (
    <div className={clsx(styles.inputGroup, fullWidth && styles.inputGroupFullWidth)}>
      {labelElement}
      {inputWithToggle}
      {errorElement}
      {hintElement}
    </div>
  );
}
