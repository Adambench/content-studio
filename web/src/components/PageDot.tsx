export function PageDot({ color, className = '' }: { color: string; className?: string }) {
  return <span className={`inline-block size-2 shrink-0 rounded-full ${className}`} style={{ background: color }} />;
}
