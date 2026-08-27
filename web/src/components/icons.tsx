const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IconCellar() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...p} d="M10 3h4v4c0 2.5 2.5 3.5 2.5 6v7.5a1.5 1.5 0 0 1-1.5 1.5H9a1.5 1.5 0 0 1-1.5-1.5V13c0-2.5 2.5-3.5 2.5-6V3Z" />
      <path {...p} d="M9 14h6" />
    </svg>
  );
}

export function IconDrinks() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...p} d="M7 3h10l-1 8a4 4 0 0 1-8 0L7 3Z" />
      <path {...p} d="M12 15v6M8 21h8" />
    </svg>
  );
}

export function IconScan() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path {...p} d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" />
      <path {...p} d="M7 12h10" />
    </svg>
  );
}

export function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle {...p} cx="12" cy="12" r="3" />
      <path {...p} d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.5a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.5h4l.4-2.5a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </svg>
  );
}
