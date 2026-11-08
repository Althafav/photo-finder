'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Field, Input, Logo, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace('/dashboard');
      router.refresh();
    } else {
      setError((await res.json().catch(() => ({}))).error ?? 'Login failed');
      setBusy(false);
    }
  }

  return (
    <main className="flex-1 grid place-items-center px-5 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo />
        </div>
        <Card className="p-6">
          <h1 className="font-display text-3xl">Admin login</h1>
          <p className="text-sm text-muted mt-1 mb-6">Manage your events and uploads.</p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Password">
              <Input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" className="w-full h-11" disabled={busy || !password}>
              {busy && <Spinner />} Log in
            </Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
