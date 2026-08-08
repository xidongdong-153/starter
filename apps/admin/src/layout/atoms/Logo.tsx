import { LayoutDashboard } from 'lucide-react'

interface LogoProps {
  size?: number
}

/**
 * 应用 Logo
 */
export function Logo({ size = 32 }: LogoProps) {
  return (
    <span
      className="border-border-subtle bg-primary/12 text-primary flex shrink-0 items-center justify-center rounded-full border"
      style={{ height: size, width: size }}
    >
      <LayoutDashboard size={Math.round(size * 0.55)} />
    </span>
  )
}
