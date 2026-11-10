/**
 * Conjunto único de ícones de traço (24x24, `currentColor`). Use `<Icon name="..." />` em vez de
 * desenhar SVG novo em cada tela. O traço vem do CSS (`.ui-icon-btn svg`, `.ui-list-item > svg`) ou
 * dos atributos abaixo quando o ícone aparece solto.
 */

export type IconName =
  | 'live'
  | 'home'
  | 'compare'
  | 'capture'
  | 'coach'
  | 'guide'
  | 'config'
  | 'menu'
  | 'close'
  | 'lock'
  | 'unlock'
  | 'fullscreen'
  | 'layout'
  | 'remote'
  | 'radio'
  | 'chevron-right'
  | 'chevron-down'
  | 'check'
  | 'plus'
  | 'search'
  | 'info'
  | 'alert'
  | 'trash'
  | 'edit'
  | 'back'
  | 'arrow-up'
  | 'arrow-down'
  | 'star'
  | 'minus'
  | 'play'
  | 'stop'
  | 'volume'
  | 'volume-off'
  | 'refresh'
  | 'copy';

const PATHS: Record<IconName, string[]> = {
  live: ['M4 17a8 8 0 1 1 16 0', 'M12 17l4-6', 'M11 17a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  home: ['M5 5c4-2 9 0 11 3s-1 5-4 6-5 3-3 5 6 2 9-1', 'M4 5a1 1 0 1 0 2 0a1 1 0 1 0-2 0'],
  compare: ['M4 18l5-7 4 4 7-9', 'M4 6l5 4 4-2 7 5'],
  capture: ['M4 12a8 8 0 1 0 16 0a8 8 0 1 0-16 0', 'M9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  coach: ['M5 6h14v9H11l-4 3v-3H5z', 'M9 10h6'],
  guide: [
    'M5 5.5C5 4.7 5.7 4 6.5 4H19v13H6.5A1.5 1.5 0 0 0 5 18.5z',
    'M5 18.5A1.5 1.5 0 0 0 6.5 20H19v-3',
    'M9 8h6',
  ],
  config: [
    'M5 8h9M18 8h1M5 16h1M10 16h9',
    'M14 8a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M6 16a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  menu: ['M5 7h14M5 12h14M5 17h14'],
  close: ['M6 6l12 12M18 6L6 18'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  unlock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
  fullscreen: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  layout: ['M4 5h7v6H4zM13 5h7v3h-7zM13 10h7v9h-7zM4 13h7v6H4z'],
  remote: ['M7 3h10v18H7z', 'M11 18h2'],
  radio: [
    'M6 9a8 8 0 0 0 0 6M18 9a8 8 0 0 1 0 6M9 7a5 5 0 0 0 0 10M15 7a5 5 0 0 1 0 10',
    'M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  ],
  'chevron-right': ['M9 5l7 7-7 7'],
  'chevron-down': ['M5 9l7 7 7-7'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  plus: ['M12 5v14M5 12h14'],
  search: ['M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M16 16l4 4'],
  info: ['M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0', 'M12 11v5', 'M12 8h.01'],
  alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
  trash: ['M5 7h14', 'M9 7V4h6v3', 'M7 7l1 13h8l1-13'],
  edit: ['M4 20h4L19 9l-4-4L4 16z'],
  back: ['M15 5l-7 7 7 7'],
  'arrow-up': ['M12 19V5', 'M6 11l6-6 6 6'],
  'arrow-down': ['M12 5v14', 'M6 13l6 6 6-6'],
  star: ['M12 4l2.4 5 5.6.7-4.1 3.8 1.1 5.5-5-2.7-5 2.7 1.1-5.5L4 9.7 9.6 9z'],
  minus: ['M5 12h14'],
  play: ['M8 5l11 7-11 7z'],
  stop: ['M7 7h10v10H7z'],
  volume: ['M4 10v4h4l5 4V6L8 10z', 'M16.5 9a4 4 0 0 1 0 6', 'M19 7a7 7 0 0 1 0 10'],
  'volume-off': ['M4 10v4h4l5 4V6L8 10z', 'M17 9l4 6M21 9l-4 6'],
  refresh: ['M19 12a7 7 0 1 1-2.1-5', 'M19 5v4h-4'],
  copy: ['M9 9h10v11H9z', 'M5 15V4h10'],
};

export function Icon({
  name,
  size = 20,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
