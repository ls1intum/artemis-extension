import clsx from 'clsx';
import styles from './AskIris.module.css';

export interface AskIrisProps {
  onClick?: () => void;
  label?: string;
  className?: string;
}

export function AskIris({
  onClick,
  label = 'Ask Iris',
  className,
}: AskIrisProps) {
  return (
    <button
      type="button"
      className={clsx(styles.askIris, className)}
      onClick={onClick}
    >
      <svg
        className={styles.irisIcon}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
        <circle cx="12" cy="12" r="6" stroke="currentColor" strokeWidth="2"/>
        <circle cx="12" cy="12" r="2" fill="currentColor"/>
        <path d="M12 2V6M12 18V22M22 12H18M6 12H2M19.07 4.93L16.24 7.76M7.76 16.24L4.93 19.07M19.07 19.07L16.24 16.24M7.76 7.76L4.93 4.93" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <span className={styles.label}>{label}</span>
    </button>
  );
}
