import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface LoadingProps {
  fullScreen?: boolean
}

const StyledWrapper = styled.div<{ $fullScreen: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: ${({ $fullScreen }) => ($fullScreen ? '100vh' : '320px')};
  padding: 2.5rem 1.5rem;

  .loading-content {
    width: min(100%, 24rem);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 1.5rem 1.25rem;
    border: 1px solid color-mix(in srgb, var(--color-border-subtle) 78%, transparent);
    border-radius: 1.75rem;
    background: color-mix(in srgb, var(--color-surface) 74%, transparent);
    box-shadow: 0 18px 42px -34px color-mix(in srgb, var(--color-primary) 16%, transparent);
    backdrop-filter: blur(8px);
  }

  .loading-eyebrow {
    margin-top: 1rem;
    color: var(--color-fg-muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .loading-title {
    margin: 0.75rem 0 0;
    color: var(--color-fg);
    font-size: 1.125rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }

  .loading-description {
    margin: 0.5rem 0 0;
    color: var(--color-fg-muted);
    font-size: 0.875rem;
    line-height: 1.8;
    max-width: 20rem;
  }

  .loading-wave {
    width: min(18.75rem, 100%);
    height: 5.5rem;
    display: flex;
    justify-content: center;
    align-items: flex-end;
  }

  .loading-bar {
    width: 1.125rem;
    height: 0.75rem;
    margin: 0 0.375rem;
    background: color-mix(in srgb, var(--color-primary) 78%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-primary) 22%, transparent);
    border-radius: 999px;
    box-shadow: 0 10px 24px -18px color-mix(in srgb, var(--color-primary) 26%, transparent);
    animation: loading-wave-animation 1s ease-in-out infinite;
  }

  .loading-bar:nth-child(2) {
    animation-delay: 0.1s;
  }

  .loading-bar:nth-child(3) {
    animation-delay: 0.2s;
  }

  .loading-bar:nth-child(4) {
    animation-delay: 0.3s;
  }

  @keyframes loading-wave-animation {
    0% {
      height: 0.75rem;
      opacity: 0.65;
    }

    50% {
      height: 3rem;
      opacity: 1;
    }

    100% {
      height: 0.75rem;
      opacity: 0.65;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-bar {
      animation: none;
      height: 1.5rem;
      opacity: 0.85;
    }
  }

  @supports not (backdrop-filter: blur(8px)) {
    .loading-content {
      background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    }
  }
`

/**
 * 通用加载状态。默认用于页面区块，占满视口时传 fullScreen。
 */
export function Loading({ fullScreen = false }: LoadingProps) {
  const { t } = useTranslation()

  return (
    <StyledWrapper $fullScreen={fullScreen}>
      <div className="loading-content">
        <div className="loading-wave" aria-hidden="true">
          <div className="loading-bar" />
          <div className="loading-bar" />
          <div className="loading-bar" />
          <div className="loading-bar" />
        </div>

        <div className="loading-eyebrow">Loading</div>
        <h2 className="loading-title">{t('common.loadingTitle')}</h2>
        <p className="loading-description">{t('common.loadingDescription')}</p>
      </div>
    </StyledWrapper>
  )
}
