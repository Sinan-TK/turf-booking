/**
 * A facility's custom icon, drawn as a mask in the surrounding text colour (like the icon font), sized by font-size.
 * As an image mask it can never run code, whatever the markup; the API also only stores SVG that passed cleanIconSvg.
 */
export function SvgMaskIcon({ svg, className = '' }: { svg: string; className?: string }) {
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
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
