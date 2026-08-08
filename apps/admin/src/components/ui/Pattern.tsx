interface PatternProps {
  /**
   * 光斑漂移时长（秒）
   */
  animationDuration?: number
}

/**
 * 页面底层背景。只做轻微光斑漂移，支持 prefers-reduced-motion。
 */
export function Pattern({ animationDuration = 18 }: PatternProps) {
  return (
    <>
      <style>{`
        .pattern-root {
          position: fixed;
          inset: 0;
          overflow: hidden;
          background:
            radial-gradient(circle at 14% 8%, color-mix(in srgb, var(--color-primary) 8%, transparent), transparent 34%),
            radial-gradient(circle at 84% 14%, color-mix(in srgb, var(--color-info) 6%, transparent), transparent 28%),
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--color-surface) 97%, transparent),
              color-mix(in srgb, var(--color-surface-muted) 96%, transparent)
            );
        }

        .pattern-grid {
          position: fixed;
          inset: 0;
          background-image:
            linear-gradient(to right, color-mix(in srgb, var(--color-border-subtle) 16%, transparent) 1px, transparent 1px),
            linear-gradient(to bottom, color-mix(in srgb, var(--color-border-subtle) 14%, transparent) 1px, transparent 1px);
          background-size: 48px 48px;
          mask-image: linear-gradient(180deg, rgba(0, 0, 0, 0.38), rgba(0, 0, 0, 0.08));
          opacity: 0.24;
        }

        .pattern-glow {
          position: absolute;
          border-radius: 999px;
          filter: blur(60px);
        }

        .pattern-glow-primary {
          top: -12vw;
          right: -6vw;
          width: 28vw;
          height: 28vw;
          background: color-mix(in srgb, var(--color-primary) 10%, transparent);
          opacity: 0.22;
          animation: pattern-drift ${animationDuration}s ease-in-out infinite alternate;
          will-change: transform;
        }

        .pattern-glow-secondary {
          bottom: -16vw;
          left: -12vw;
          width: 34vw;
          height: 34vw;
          background: color-mix(in srgb, var(--color-highlight) 8%, transparent);
          opacity: 0.14;
        }

        @keyframes pattern-drift {
          0% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          100% {
            transform: translate3d(12px, 16px, 0) scale(1.04);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pattern-glow-primary {
            animation: none;
          }
        }
      `}</style>
      <div className="pattern-root">
        <div className="pattern-grid" />
        <div className="pattern-glow pattern-glow-primary" />
        <div className="pattern-glow pattern-glow-secondary" />
      </div>
    </>
  )
}
