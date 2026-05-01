'use client';
import { useState, useEffect, useCallback } from 'react';
import { isAuthenticated, logout, getCurrentRole } from '@/lib/auth';

export function useAuth() {
  const [authed, setAuthed]   = useState(false);
  const [role,   setRole]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setAuthed(isAuthenticated());
    setRole(getCurrentRole());
    setLoading(false);
  }, []);

  const login = useCallback(async (pw) => {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ method: 'GET', table: 'products', query: 'select=id&limit=1', _ts: Date.now() }),
    });
    if (res.status === 401) throw new Error('Wrong password');
    if (!res.ok) throw new Error('Server error');

    // Determine role
    let detectedRole = 'owner';
    const ownerRes = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
      body: JSON.stringify({ method: 'GET', table: 'admin_logs', query: 'select=id&limit=1', _ts: Date.now() }),
    });
    if (ownerRes.status === 403) {
      // Try packing check
      const packRes = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': pw },
        body: JSON.stringify({ method: 'GET', table: 'customers', query: 'select=id&limit=1', _ts: Date.now() }),
      });
      detectedRole = packRes.status === 403 ? 'packing' : 'manager';
    }

    sessionStorage.setItem('pr_pw', pw);
    sessionStorage.setItem('pr_role', detectedRole);
    setAuthed(true);
    setRole(detectedRole);
    return detectedRole;
  }, []);

  const doLogout = useCallback(() => {
    logout();
    setAuthed(false);
    setRole(null);
  }, []);

  return { authed, role, loading, login, logout: doLogout };
}
