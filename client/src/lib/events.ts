const BALANCES_CHANGED = 'balances-changed'
const GOALS_CHANGED = 'goals-changed'

export function emitBalancesChanged(): void {
  window.dispatchEvent(new Event(BALANCES_CHANGED))
}

export function onBalancesChanged(handler: () => void): () => void {
  window.addEventListener(BALANCES_CHANGED, handler)
  return () => window.removeEventListener(BALANCES_CHANGED, handler)
}

export function emitGoalsChanged(): void {
  window.dispatchEvent(new Event(GOALS_CHANGED))
}

export function onGoalsChanged(handler: () => void): () => void {
  window.addEventListener(GOALS_CHANGED, handler)
  return () => window.removeEventListener(GOALS_CHANGED, handler)
}
