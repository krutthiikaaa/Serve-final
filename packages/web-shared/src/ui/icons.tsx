import type { SVGProps } from 'react';

/** Minimal stroke icon set (24px grid). Decorative unless a title is given. */
type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function make(paths: string[]) {
  return function Icon({ title, ...props }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title ? undefined : true}
        role={title ? 'img' : undefined}
        {...props}
      >
        {title ? <title>{title}</title> : null}
        {paths.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    );
  };
}

export const IconBell = make([
  'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9',
  'M10.3 21a1.94 1.94 0 0 0 3.4 0',
]);
export const IconGrid = make(['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M14 14h7v7h-7z', 'M3 14h7v7H3z']);
export const IconReceipt = make([
  'M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2l-1 .7-3-2-3 2-3-2-3 2-3-2z',
  'M8 8h8',
  'M8 12h8',
  'M8 16h5',
]);
export const IconUtensils = make([
  'M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2',
  'M7 2v20',
  'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7',
]);
export const IconUser = make([
  'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2',
  'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
]);
export const IconUsers = make([
  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
  'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'M22 21v-2a4 4 0 0 0-3-3.87',
  'M16 3.13a4 4 0 0 1 0 7.75',
]);
export const IconStore = make([
  'M3 9l1-5h16l1 5',
  'M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z',
  'M5 21V12',
  'M19 21V12',
  'M3 21h18',
]);
export const IconInbox = make([
  'M22 12h-6l-2 3h-4l-2-3H2',
  'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
]);
export const IconLogout = make([
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4',
  'M16 17l5-5-5-5',
  'M21 12H9',
]);
export const IconCheck = make(['M20 6 9 17l-5-5']);
export const IconX = make(['M18 6 6 18', 'M6 6l12 12']);
export const IconClock = make(['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2']);
export const IconFlame = make([
  'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z',
]);
export const IconBag = make([
  'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z',
  'M3 6h18',
  'M16 10a4 4 0 0 1-8 0',
]);
export const IconRefresh = make([
  'M3 12a9 9 0 0 1 15-6.7L21 8',
  'M21 3v5h-5',
  'M21 12a9 9 0 0 1-15 6.7L3 16',
  'M8 16H3v5',
]);
export const IconPlus = make(['M12 5v14', 'M5 12h14']);
export const IconEdit = make(['M12 20h9', 'M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z']);
export const IconPause = make(['M10 4H6v16h4z', 'M18 4h-4v16h4z']);
export const IconPlay = make(['M6 3l14 9-14 9z']);
export const IconAlert = make([
  'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  'M12 9v4',
  'M12 17h.01',
]);
export const IconWifiOff = make([
  'M2 2l20 20',
  'M8.5 16.5a5 5 0 0 1 7 0',
  'M2 8.82a15 15 0 0 1 4.17-2.65',
  'M10.66 5c4.01-.36 8.14.9 11.34 3.76',
  'M16.85 11.25a10 10 0 0 1 2.22 1.68',
  'M5 13a10 10 0 0 1 5.24-2.76',
  'M12 20h.01',
]);
