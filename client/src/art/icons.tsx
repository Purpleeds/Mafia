import {
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  CircleHelp,
  Clock,
  Copy,
  Crop,
  Crown,
  Dices,
  Ellipsis,
  Eye,
  EyeOff,
  FastForward,
  Flag,
  Hand,
  Heart,
  HeartCrack,
  History,
  House,
  ImageUp,
  Info,
  Keyboard,
  Lightbulb,
  Lock,
  LockOpen,
  LogOut,
  MessageSquareMore,
  MessageSquareOff,
  Mic,
  Moon,
  NotebookPen,
  Pause,
  Play,
  Plus,
  Scale,
  Search,
  Share2,
  Shield,
  ShieldCheck,
  Skull,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
  Trophy,
  UserCheck,
  UserMinus,
  UserPlus,
  Volume2,
  VolumeX,
  Vote,
  Wifi,
  WifiOff,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";

/**
 * The one icon set used everywhere: Lucide (ISC licence), drawn as line icons
 * in the current text colour. Screens refer to icons by these names, so the
 * set can change in one place.
 */
const ICONS = {
  check: Check,
  close: X,
  back: ChevronLeft,
  forward: ChevronRight,
  lock: Lock,
  unlock: LockOpen,
  crown: Crown,
  timer: Timer,
  clock: Clock,
  ballot: Vote,
  skip: ChevronsRight,
  heart: Heart,
  brokenHeart: HeartCrack,
  sparkle: Sparkles,
  dice: Dices,
  help: CircleHelp,
  eye: Eye,
  eyeOff: EyeOff,
  moon: Moon,
  sun: Sun,
  mic: Mic,
  copy: Copy,
  share: Share2,
  phone: Smartphone,
  warn: TriangleAlert,
  home: House,
  grave: Skull,
  scales: Scale,
  trophy: Trophy,
  flag: Flag,
  whisper: MessageSquareMore,
  chatOff: MessageSquareOff,
  shield: Shield,
  shieldCheck: ShieldCheck,
  search: Search,
  sliders: SlidersHorizontal,
  leave: LogOut,
  volume: Volume2,
  volumeOff: VolumeX,
  info: Info,
  bulb: Lightbulb,
  image: ImageUp,
  crop: Crop,
  zoomIn: ZoomIn,
  zoomOut: ZoomOut,
  trash: Trash2,
  pause: Pause,
  play: Play,
  plus: Plus,
  fastForward: FastForward,
  notes: NotebookPen,
  history: History,
  keyboard: Keyboard,
  more: Ellipsis,
  ban: Ban,
  hand: Hand,
  ready: UserCheck,
  userPlus: UserPlus,
  userMinus: UserMinus,
  online: Wifi,
  offline: WifiOff,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function isIconName(value: string): value is IconName {
  return Object.hasOwn(ICONS, value);
}

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Give a title only when the icon is the sole content; otherwise it is decorative. */
  title?: string;
}

export function Icon({ name, size = 18, className, title }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      size={size}
      strokeWidth={2}
      className={`icon${className ? ` ${className}` : ""}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    />
  );
}
