'use client';

export default function MessagesClient({ viewerRole }: { viewerRole: string | null }): React.JSX.Element {
  return <div className="px-6 py-8" data-role={viewerRole ?? ''}>Messages</div>;
}
