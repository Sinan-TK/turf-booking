/**
 * A facility's custom icon, drawn in the colours it was made with, sized by font-size.
 * Shown as an image, so it can never run code, whatever the markup; the API also only stores SVG that passed cleanIconSvg.
 */
export function SvgMaskIcon({ svg, className = '' }: { svg: string; className?: string }) {
  return (
    <img
      alt=""
      aria-hidden="true"
      src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ width: '1em', height: '1em' }}
    />
  );
}
