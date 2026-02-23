// Atomic components
export { Button, IconButton } from './Button';
export type {
  ButtonProps,
  IconButtonProps,
  CloseIconButtonProps,
  CheckmarkIconButtonProps,
  BurgerMenuIconButtonProps,
  CollapseIconButtonProps,
  FullscreenIconButtonProps,
  ReloadIconButtonProps,
  SettingsIconButtonProps,
} from './Button';

export { Badge } from './Badge';
export type { BadgeProps } from './Badge';

export { BackLink } from './BackLink';
export type { BackLinkProps } from './BackLink';

// Form components
export { TextInput } from './TextInput';
export type { TextInputProps } from './TextInput';

export { Dropdown } from './Dropdown';
export type { DropdownProps, DropdownOption } from './Dropdown';

// Layout components
export { Container } from './Container';
export type { ContainerProps } from './Container';

export { ListItem } from './ListItem';
export type { ListItemProps } from './ListItem';

export { List } from './List';
export type { ListProps } from './List';

// Composite components
export { HelpPopup } from './HelpPopup';
export type { HelpPopupProps } from './HelpPopup';

export { SideMenu } from './SideMenu';
export type { SideMenuProps } from './SideMenu';

export { AskIris } from './AskIris';
export type { AskIrisProps } from './AskIris';

export { ServiceHealth } from './ServiceHealth';
export type { ServiceHealthProps, ServiceStatus } from './ServiceHealth';

// Shared exercise components
export {
  SubmissionStatus,
  ParticipationActions,
  BuildProgress,
} from './exercise';
export type {
  SubmissionStatusProps,
  SubmissionStatusType,
  TestCase,
  Feedback,
  ParticipationActionsProps,
  ExerciseType,
  ParticipationStatusType,
  RepositoryStatus,
  WorkspaceStatus,
  BuildProgressProps,
  BuildState,
  LogEntry,
} from './exercise';

// UI primitives for Phase 4
export { Skeleton, SkeletonList } from './Skeleton';
export type { SkeletonProps, SkeletonListProps } from './Skeleton';

export { Breadcrumbs } from './Breadcrumbs';
export type { BreadcrumbsProps, BreadcrumbSegment } from './Breadcrumbs';

export { ReconnectBanner } from './ReconnectBanner';

export { ErrorMessage } from './ErrorMessage';
export type { ErrorMessageProps } from './ErrorMessage';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
