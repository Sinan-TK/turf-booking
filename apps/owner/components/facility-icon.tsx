/**
 * A facility's icon: its pasted SVG when it has one (drawn as a mask in the text colour, so it can never run code), else the named
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
  const url = `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`;
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 bg-current align-middle ${className}`}
      style={{
        width: '1em',
        height: '1em',
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
      }}
    />
  );
}
