import clsx from 'clsx';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import { KeyboardEvent, useId, useState } from 'react';

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
  onBlur?: () => void;
  onFocus?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  fullWidth?: boolean;
  maxLength?: number;
  autocomplete?: string;
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
  onBlur,
  onFocus,
  onKeyDown,
  fullWidth = false,
  maxLength,
  autocomplete = 'off',
  testId,
}: TextInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  const generatedId = useId();
  // `||`, not `??`: an empty id is no id, and letting it through would point
  // the label and the aria-describedby refs at nothing.
  const inputId = id || generatedId;
  const errorId = error ? `${inputId}-error` : undefined;
  const hintId = hint ? `${inputId}-hint` : undefined;

  const inputClasses = clsx(
    styles.input,
    {
      [styles.inputFullWidth]: fullWidth,
      [styles.inputError]: Boolean(error),
      [styles.inputDisabled]: disabled,
    },
    className
  );

  const isPassword = type === 'password';
  const ariaDescribedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  const inputElement = (
    <input
      id={inputId}
      type={isPassword && showPassword ? 'text' : type}
      className={inputClasses}
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={() => onBlur?.()}
      onFocus={() => onFocus?.()}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      maxLength={maxLength}
      autoComplete={autocomplete}
      aria-describedby={ariaDescribedBy}
      aria-invalid={Boolean(error)}
      data-testid={testId}
    />
  );

  const field = isPassword ? (
    <div className={styles.inputPasswordWrapper}>
      {inputElement}
      <button
        type="button"
        className={styles.inputPasswordToggle}
        onClick={() => setShowPassword(!showPassword)}
        aria-label="Toggle password visibility"
        tabIndex={-1}
      >
        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  ) : (
    inputElement
  );

  // With nothing to label or annotate, the field stands on its own. The
  // wrapper below is a layout container for those extras, so adding it here
  // would change the spacing of every bare input.
  if (!label && !error && !hint) {
    return field;
  }

  return (
    <div className={clsx(styles.inputGroup, fullWidth && styles.inputGroupFullWidth)}>
      {label && (
        <label className={styles.inputLabel} htmlFor={inputId}>
          {label}
          {required && <span className={styles.inputRequired}>*</span>}
        </label>
      )}
      {field}
      {error && (
        <span id={errorId} className={styles.inputErrorMessage}>
          {error}
        </span>
      )}
      {!error && hint && (
        <span id={hintId} className={styles.inputHelperText}>
          {hint}
        </span>
      )}
    </div>
  );
}
