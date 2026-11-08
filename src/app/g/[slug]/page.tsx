import { Suspense } from 'react';
import GuestGallery from '@/components/GuestGallery';

export default function GuestPage() {
  return (
    <Suspense>
      <GuestGallery />
    </Suspense>
  );
}
