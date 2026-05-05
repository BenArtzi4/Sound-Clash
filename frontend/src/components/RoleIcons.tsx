interface IconProps {
  className?: string;
}

export function ManagerIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      role="img"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="mgr-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect x="22" y="6" width="20" height="34" rx="10" fill="url(#mgr-grad)" />
      <path
        d="M14 30c0 9.94 8.06 18 18 18s18-8.06 18-18"
        fill="none"
        stroke="url(#mgr-grad)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="32"
        y1="48"
        x2="32"
        y2="58"
        stroke="url(#mgr-grad)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="22"
        y1="58"
        x2="42"
        y2="58"
        stroke="url(#mgr-grad)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TeamIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      role="img"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="team-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect
        x="16"
        y="6"
        width="32"
        height="52"
        rx="6"
        fill="none"
        stroke="url(#team-grad)"
        strokeWidth="3.5"
      />
      <line
        x1="28"
        y1="50"
        x2="36"
        y2="50"
        stroke="url(#team-grad)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="26" cy="28" r="4" fill="url(#team-grad)" />
      <line
        x1="30"
        y1="28"
        x2="30"
        y2="18"
        stroke="url(#team-grad)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M30 18c4 0 6 2 6 5"
        stroke="url(#team-grad)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function DisplayIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width="64"
      height="64"
      role="img"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="disp-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#0e7490" />
        </linearGradient>
      </defs>
      <rect
        x="6"
        y="10"
        width="52"
        height="34"
        rx="4"
        fill="none"
        stroke="url(#disp-grad)"
        strokeWidth="3.5"
      />
      <line
        x1="24"
        y1="50"
        x2="40"
        y2="50"
        stroke="url(#disp-grad)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <line
        x1="32"
        y1="44"
        x2="32"
        y2="50"
        stroke="url(#disp-grad)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <g fill="url(#disp-grad)">
        <rect x="14" y="30" width="4" height="8" rx="1.5" />
        <rect x="22" y="22" width="4" height="16" rx="1.5" />
        <rect x="30" y="18" width="4" height="20" rx="1.5" />
        <rect x="38" y="24" width="4" height="14" rx="1.5" />
        <rect x="46" y="28" width="4" height="10" rx="1.5" />
      </g>
    </svg>
  );
}
