'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button, Logo } from './ui';

export function DashboardHeader() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
  }
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 h-16 flex items-center justify-between">
        <Logo href="/dashboard" />
        <Button variant="ghost" onClick={logout}>
          <LogOut className="size-4" /> Log out
        </Button>
      </div>
    </header>
  );
}

/** fetch() wrapper for admin APIs: bounces to /login on 401 and throws API errors. */
export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type AdminEvent = {
  id: string;
  slug: string;
  name: string;
  date?: string;
  expiresAt?: string;
  createdAt: string;
  hasPassword: boolean;
  photoCount?: number;
  driveFolderId?: string;
};
