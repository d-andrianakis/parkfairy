import { encode } from 'uqr';

/**
 * A QR code as one SVG path (no innerHTML). Always dark on light, whatever the theme:
 * scanners need the contrast. `label` names it for screen readers; offer the same data as
 * text next to it.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const { data } = encode(value, { border: 2 });
  const size = data.length;
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
