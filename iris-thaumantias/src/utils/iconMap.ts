/**
 * Centralized icon mapping using Lucide React components
 * All icons are imported individually to enable tree-shaking
 */

import {
  CircleDot,
  Code2,
  CheckCircle,
  Upload,
  Box,
  FileText,
  BookOpen,
  ClipboardList,
  RefreshCw,
  Trash2,
  Stethoscope,
  Star,
  Sparkles,
  MousePointer,
  Settings,
  Puzzle,
  Globe,
  LogOut,
  MessageSquarePlus,
  KeyRound,
  Shield,
  Copy,
  Link,
  GitBranch,
  HelpCircle,
  ThumbsUp,
  ThumbsDown,
  LayoutGrid,
  Target,
  Eye,
  EyeOff,
  Check,
  Plus,
  File,
  X,
  ChevronDown,
  ChevronRight,
  XCircle,
  Bug,
  type LucideIcon,
} from 'lucide-react';

/**
 * Typed icon map - all exercise and UI icons
 */
export const ICONS = {
  default: CircleDot,
  programming: Code2,
  quiz: CheckCircle,
  'file-upload': Upload,
  modeling: Box,
  text: FileText,
  course: BookOpen,
  exercise: ClipboardList,
  refresh: RefreshCw,
  trash: Trash2,
  stethoscope: Stethoscope,
  star: Star,
  'star-4-edges': Sparkles,
  cursor: MousePointer,
  gear: Settings,
  puzzle: Puzzle,
  web: Globe,
  logout: LogOut,
  uploadmessage: MessageSquarePlus,
  key: KeyRound,
  shield: Shield,
  copy: Copy,
  link: Link,
  git: GitBranch,
  'question-mark': HelpCircle,
  'thumbs-up': ThumbsUp,
  'thumbs-down': ThumbsDown,
  workspace: LayoutGrid,
  target: Target,
  'eye-open': Eye,
  'eye-closed': EyeOff,
  check: Check,
  plus: Plus,
  file: File,
  close: X,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  'info-circle': XCircle,
  bug: Bug,
} as const satisfies Record<string, LucideIcon>;

/**
 * Type representing all available icon keys
 */
export type IconKey = keyof typeof ICONS;

/**
 * Get an icon component by type string
 * Normalizes input (lowercase, replace underscores) and falls back to default icon
 *
 * @param type - Icon type string (e.g., "programming", "QUIZ", "file_upload")
 * @returns Lucide icon component
 *
 * @example
 * ```tsx
 * const Icon = getIcon('programming');
 * return <Icon size={16} />;
 * ```
 */
export function getIcon(type: string | undefined): LucideIcon {
  const normalizedType = type?.toLowerCase().replace(/_/g, '-') || 'default';
  return ICONS[normalizedType as IconKey] || ICONS.default;
}
