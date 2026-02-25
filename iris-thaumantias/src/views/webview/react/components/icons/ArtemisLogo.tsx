/**
 * Artemis Logo Component
 * Standalone React component matching Lucide's prop API
 */

import { type LucideProps } from 'lucide-react';

export interface ArtemisLogoProps extends Omit<LucideProps, 'ref'> {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * Artemis logo as a React component with Lucide-compatible API
 * The logo consists of two paths: a stroked arrow and a filled triangle
 */
export function ArtemisLogo({
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className,
  ...props
}: ArtemisLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 232 204"
      fill="none"
      className={className}
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M151 66L112 99.8764L229 201L151 66Z"
        stroke={color}
        strokeWidth={strokeWidth}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M0 198.5L153.5 65L115.5 0L0 198.5Z"
        fill={color}
      />
    </svg>
  );
}
