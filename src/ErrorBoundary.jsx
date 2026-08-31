import React from 'react'
import {
  BASELINE_CHECKPOINT_KEY,
  promotePreviousCheckpoint,
} from './recoveryCheckpoint.js'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, recovering: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  handlePreviousCheckpoint = async () => {
    this.setState({ recovering: true })
    const restored = await promotePreviousCheckpoint(BASELINE_CHECKPOINT_KEY)
    if (restored) {
      window.location.reload()
      return
    }
    this.setState({ recovering: false })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px 20px',
          maxWidth: '600px',
          margin: '60px auto',
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
          textAlign: 'center',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        }}>
          <h2 style={{ fontSize: '20px', color: '#e11d48', marginBottom: '12px' }}>
            화면 표시 중 일시적인 문제가 발생했습니다
          </h2>
          <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.6', marginBottom: '20px' }}>
            {this.state.error?.message || '알 수 없는 오류가 발생했습니다.'}
          </p>
          <p style={{ fontSize: '14px', color: '#475569', lineHeight: '1.6', marginBottom: '20px' }}>
            생성한 사진을 포함한 작업이 자동 저장되어 있습니다. 마지막 저장 상태를 먼저 불러오고, 문제가 반복되면 이전 체크포인트를 사용하세요.
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              마지막 저장 상태
            </button>
            <button
              onClick={this.handlePreviousCheckpoint}
              disabled={this.state.recovering}
              style={{
                padding: '10px 20px',
                background: '#f1f5f9',
                color: '#334155',
                border: '1px solid #cbd5e1',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {this.state.recovering ? '복구 중…' : '이전 체크포인트'}
            </button>
            <button onClick={this.handleReset}>화면만 다시 시도</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
