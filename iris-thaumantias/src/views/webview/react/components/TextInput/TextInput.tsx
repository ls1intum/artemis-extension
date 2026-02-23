import { useState, KeyboardEvent, FocusEvent } from 'react';
import clsx from 'clsx';
import styles from './TextInput.module.css';

export interface TextInputProps {
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
}: TextInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  const inputId = id || `text-input-${Math.random().toString(36).slice(2, 8)}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (onBlur) onBlur();
  };

  const handleFocus = (e: FocusEvent<HTMLInputElement>) => {
    if (onFocus) onFocus();
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
      onBlur={handleBlur}
      onFocus={handleFocus}
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
            {showPassword ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 2L22 22M9.88 9.88C9.33 10.43 9 11.18 9 12C9 13.66 10.34 15 12 15C12.82 15 13.57 14.67 14.12 14.12M19.73 16.27C17.94 17.5 15.97 18 12 18C8 18 5 16 2 12C3.29 10.21 4.78 8.81 6.47 7.73M9.9 4.24C10.6 4.07 11.3 4 12 4C16 4 19 6 22 10C21.27 11.11 20.42 12.11 19.49 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
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
        {showPassword ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2L22 22M9.88 9.88C9.33 10.43 9 11.18 9 12C9 13.66 10.34 15 12 15C12.82 15 13.57 14.67 14.12 14.12M19.73 16.27C17.94 17.5 15.97 18 12 18C8 18 5 16 2 12C3.29 10.21 4.78 8.81 6.47 7.73M9.9 4.24C10.6 4.07 11.3 4 12 4C16 4 19 6 22 10C21.27 11.11 20.42 12.11 19.49 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 12C2 12 5 5 12 5C19 5 22 12 22 12C22 12 19 19 12 19C5 19 2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
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
