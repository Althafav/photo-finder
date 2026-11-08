import { Suspense } from 'react';
import EventManager from '@/components/EventManager';

export default function EventPage() {
  return (
    <Suspense>
      <EventManager />
    </Suspense>
  );
}
