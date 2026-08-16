/**
 * Centralized icon mapping using Lucide React components
 * All icons are imported individually to enable tree-shaking
 */

import type { LucideIcon } from 'lucide-react';
import BookOpen from 'lucide-react/dist/esm/icons/book-open';
import Box from 'lucide-react/dist/esm/icons/box';
import Bug from 'lucide-react/dist/esm/icons/bug';
import Check from 'lucide-react/dist/esm/icons/check';
import CheckCircle from 'lucide-react/dist/esm/icons/check-circle';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import CircleDot from 'lucide-react/dist/esm/icons/circle-dot';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import Code2 from 'lucide-react/dist/esm/icons/code-2';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Eye from 'lucide-react/dist/esm/icons/eye';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import File from 'lucide-react/dist/esm/icons/file';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import GitBranch from 'lucide-react/dist/esm/icons/git-branch';
import Globe from 'lucide-react/dist/esm/icons/globe';
import HelpCircle from 'lucide-react/dist/esm/icons/help-circle';
import KeyRound from 'lucide-react/dist/esm/icons/key-round';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid';
import Link from 'lucide-react/dist/esm/icons/link';
import LogOut from 'lucide-react/dist/esm/icons/log-out';
import MessageSquarePlus from 'lucide-react/dist/esm/icons/message-square-plus';
import MousePointer from 'lucide-react/dist/esm/icons/mouse-pointer';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Puzzle from 'lucide-react/dist/esm/icons/puzzle';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Settings from 'lucide-react/dist/esm/icons/settings';
import Shield from 'lucide-react/dist/esm/icons/shield';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Star from 'lucide-react/dist/esm/icons/star';
import Stethoscope from 'lucide-react/dist/esm/icons/stethoscope';
import Target from 'lucide-react/dist/esm/icons/target';
import ThumbsDown from 'lucide-react/dist/esm/icons/thumbs-down';
import ThumbsUp from 'lucide-react/dist/esm/icons/thumbs-up';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Upload from 'lucide-react/dist/esm/icons/upload';
import X from 'lucide-react/dist/esm/icons/x';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';

const ICONS = {
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

type IconKey = keyof typeof ICONS;

function isIconKey(key: string): key is IconKey {
  // Use hasOwnProperty so inherited names like 'constructor', 'toString'
  // don't slip through and return a non-LucideIcon at runtime.
  return Object.prototype.hasOwnProperty.call(ICONS, key);
}

/**
 * Lowercases the type and turns underscores into hyphens before the lookup, so
 * "QUIZ" and "file_upload" both resolve. Unknown types fall back to `default`.
 */
export function getIcon(type: string | undefined): LucideIcon {
  const normalizedType = type?.toLowerCase().replace(/_/g, '-') || 'default';
  return isIconKey(normalizedType) ? ICONS[normalizedType] : ICONS.default;
}
