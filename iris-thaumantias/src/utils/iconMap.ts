/**
 * Centralized icon mapping using Lucide React components
 * All icons are imported individually to enable tree-shaking
 */

import CircleDot from 'lucide-react/dist/esm/icons/circle-dot';
import Code2 from 'lucide-react/dist/esm/icons/code-2';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import Upload from 'lucide-react/dist/esm/icons/upload';
import Box from 'lucide-react/dist/esm/icons/box';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope';
import Star from 'lucide-react/dist/esm/icons/star';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import MousePointer from 'lucide-react/dist/esm/icons/mouse-pointer';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Puzzle from 'lucide-react/dist/esm/icons/puzzle';
import Globe from 'lucide-react/dist/esm/icons/globe';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import MessageSquarePlus from 'lucide-react/dist/esm/icons/message-square-plus';
import KeyRound from 'lucide-react/dist/esm/icons/key-round';
import Shield from 'lucide-react/dist/esm/icons/shield';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Link from 'lucide-react/dist/esm/icons/link';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid';
import Target from 'lucide-react/dist/esm/icons/target';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import File from 'lucide-react/dist/esm/icons/file';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import Bug from 'lucide-react/dist/esm/icons/bug';
import type { LucideIcon } from 'lucide-react';

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
