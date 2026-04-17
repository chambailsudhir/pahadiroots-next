'use client';
import { useState } from 'react';

export default function LoginGate({ onLogin }) {
  const [pw,       setPw]       = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const [attempts, setAttempts] = useState(0);

  async function handleLogin() {
    if (!pw.trim()) { setError('Enter password'); return; }
    if (attempts >= 5) { setError('Too many attempts. Wait 5 minutes.'); return; }
    setLoading(true); setError('');
    try {
      await onLogin(pw.trim());
    } catch (err) {
      setAttempts(a => a + 1);
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position:'fixed', inset:0,
      background:'#0a1a0d',
      display:'flex', alignItems:'center', justifyContent:'center',
      zIndex:50
    }}>
      {/* Background subtle radial glow */}
      <div style={{
        position:'absolute', inset:0,
        backgroundImage:'radial-gradient(circle at 20% 50%, rgba(26,92,42,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(26,92,42,0.1) 0%, transparent 40%)',
        pointerEvents:'none'
      }}/>

      <div style={{
        background:'#111e13',
        border:'1px solid #1a5c2a',
        borderRadius:20, padding:'36px 32px', width:340,
        boxShadow:'0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(26,92,42,0.2)',
        position:'relative', zIndex:1
      }}>
        {/* Logo */}
        <div style={{marginBottom:28, textAlign:'center'}}>
          <div style={{
            fontSize:40, marginBottom:10,
            filter:'drop-shadow(0 0 12px rgba(26,92,42,0.6))'
          }}>🌿</div>
          <div style={{
            fontSize:20, fontWeight:800, color:'#fff',
            letterSpacing:'-0.3px', marginBottom:4
          }}>
            5 Pahadi Roots
          </div>
          <div style={{
            fontSize:11, color:'#4a7c59',
            letterSpacing:'2px', textTransform:'uppercase'
          }}>
            Admin Panel
          </div>
        </div>

        {/* Divider */}
        <div style={{height:1, background:'linear-gradient(90deg, transparent, #1a5c2a, transparent)', marginBottom:24}}/>

        {/* Error */}
        {error && (
          <div style={{
            color:'#f85149', fontSize:13, marginBottom:16,
            background:'rgba(248,81,73,0.1)', border:'1px solid rgba(248,81,73,0.3)',
            borderRadius:8, padding:'8px 12px'
          }}>
            {error}
          </div>
        )}

        {/* Password */}
        <div style={{marginBottom:16}}>
          <label style={{
            fontSize:11, fontWeight:600, color:'#4a7c59',
            textTransform:'uppercase', letterSpacing:'0.08em',
            display:'block', marginBottom:8
          }}>
            Admin Password
          </label>
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="Enter password"
            autoFocus
            style={{
              width:'100%', boxSizing:'border-box',
              background:'rgba(26,92,42,0.08)',
              border:'1px solid #1a5c2a',
              borderRadius:10, padding:'12px 14px',
              fontSize:14, color:'#e6edf3',
              outline:'none'
            }}
          />
        </div>

        {/* Button */}
        <button
          onClick={handleLogin}
          disabled={loading}
          style={{
            width:'100%', padding:'13px',
            background: loading
              ? '#0f2d16'
              : 'linear-gradient(135deg, #1a5c2a, #2d7a3e)',
            color: '#fff', fontWeight:700, fontSize:14,
            border: '1px solid #1a5c2a',
            borderRadius:10, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            transition:'all 0.2s',
            letterSpacing:'0.3px',
            boxShadow: loading ? 'none' : '0 4px 16px rgba(26,92,42,0.4)'
          }}
        >
          {loading ? 'Signing in…' : '🔐 Sign In'}
        </button>

        <div style={{marginTop:16, fontSize:11, color:'#2d5233', textAlign:'center'}}>
          🔒 Secure · Server-side Authentication
        </div>
      </div>
    </div>
  );
}
