import type { ReactNode } from "react";

interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8" />
    </Svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </Svg>
  );
}

export function WavesIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 8.5c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2.5 14.5c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
      <path d="M2.5 20.5c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0" />
    </Svg>
  );
}

export function WavesOffIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 12c1.5 0 3 0 4.5 0s3 0 4.5 0 3 0 4.5 0 3 0 4.5 0" />
      <path d="M3 3l18 18" />
    </Svg>
  );
}

export function PinIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.2" />
    </Svg>
  );
}

export function MailIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </Svg>
  );
}

export function PhoneIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6.5 3.5 9 6 7.5 9c1 2.2 2.8 4 5 5l3-1.5 2.5 2.5c.4.4.5 1 .2 1.5-1 1.6-2.9 2.6-4.8 2.1C8.9 17.9 4.1 13.1 2.9 8.6c-.5-1.9.5-3.8 2.1-4.8.5-.3 1.1-.2 1.5.2Z" />
    </Svg>
  );
}

export function ArrowUpRightIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M7 17 17 7M9 7h8v8" />
    </Svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  );
}

export function GraduationCapIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="m2 9 10-4 10 4-10 4Z" />
      <path d="M6 11v4c0 1.1 2.7 2 6 2s6-.9 6-2v-4" />
      <path d="M22 9v6" />
    </Svg>
  );
}

export function ChalkboardIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="12" rx="1" />
      <path d="M8 20h8M12 16v4" />
      <path d="M6.5 12.5 9 8l2 3 2.5-4L17 12.5" />
    </Svg>
  );
}

export function BriefcaseIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" />
      <path d="M3 12h18" />
    </Svg>
  );
}

export function HeadsetIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <rect x="2.5" y="13" width="4" height="6" rx="1.5" />
      <rect x="17.5" y="13" width="4" height="6" rx="1.5" />
      <path d="M19.5 19v1a3 3 0 0 1-3 3h-2.5" />
    </Svg>
  );
}

export function LaptopIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="4" width="14" height="9" rx="1" />
      <path d="M2 19h20l-2-3.5H4L2 19Z" />
    </Svg>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </Svg>
  );
}

export function TerminalIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m7 9 3 3-3 3M13 15h4" />
    </Svg>
  );
}
