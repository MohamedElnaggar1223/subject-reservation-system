'use client';

import { useEffect } from 'react';
import { Button } from '~/components/ui/button';

export default function PrintButton() {
  // Auto-open the print dialog — staff clicked "Print" to get here
  useEffect(() => {
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, []);

  return <Button onClick={() => window.print()}>Print Receipt</Button>;
}
