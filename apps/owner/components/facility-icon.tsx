/**
 * A facility's icon: its pasted SVG when it has one (drawn in its own colours, as an image, so it can never run code), else the named
 * Material icon. Sized by font-size, like the icon font.
 */
export function FacilityIcon({ iconKey, iconSvg, className = '' }: { iconKey: string; iconSvg?: string | null; className?: string }) {
  if (!iconSvg) {
    return (
      <span className={`material-symbols-outlined ${className}`} aria-hidden="true">
        {iconKey || 'category'}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden="true"
      src={`data:image/svg+xml,${encodeURIComponent(iconSvg)}`}
      className={`inline-block shrink-0 align-middle ${className}`}
      style={{ width: '1em', height: '1em' }}
    />
  );
}
