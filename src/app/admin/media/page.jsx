'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function MediaRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/media/hero'); }, [router]);
  return (
    <div className="flex items-center justify-center h-40">
      <div className="text-[13px]" style={{ color: 'var(--tx2)' }}>Redirecting…</div>
    </div>
  );
}
