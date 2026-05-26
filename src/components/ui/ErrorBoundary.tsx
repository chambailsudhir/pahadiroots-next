'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children:  ReactNode
  fallback?: ReactNode
  section?:  string
  // Optional callback invoked when the user clicks "Try Again".
  // Pass the data hook's refresh/retry function here so the boundary
  // actually re-fires the failed request instead of merely re-rendering
  // children (which hits the same error again on transient network failures).
  // Example: <ErrorBoundary onRetry={orders.refresh} section="Orders">
  onRetry?:  () => void
}

interface State { hasError: boolean; error: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary:${this.props.section || 'unknown'}]`, error, info)
  }

  handleRetry = () => {
    // Call the data-layer retry first so the fetch is in-flight before
    // React re-renders the children — prevents the stale-data re-render.
    this.props.onRetry?.()
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div style={{ padding: '24px', textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚠️</div>
          <div style={{ fontWeight: 700, marginBottom: '8px' }}>
            {this.props.section ? `${this.props.section} failed to load` : 'Something went wrong'}
          </div>
          <button
            onClick={this.handleRetry}
            style={{ padding: '8px 18px', background: '#1a3a1e', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
