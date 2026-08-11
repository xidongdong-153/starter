export const authorizationDrawerClassNames = {
  body: 'bg-surface',
  footer: 'bg-surface-muted border-border',
  header: 'bg-surface-muted border-border text-fg',
  wrapper: 'text-fg',
}

export const authorizationDrawerStyles = {
  footer: {
    borderTop: '1px solid var(--color-border)',
  },
  header: {
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-fg)',
  },
  mask: {
    backgroundColor: 'color-mix(in oklab, var(--color-surface-subtle) 52%, transparent)',
  },
}

export function isAuthorizationImpactPending(state: { isFetching: boolean; isLoading: boolean }): boolean {
  return state.isLoading || state.isFetching
}
