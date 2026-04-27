export default function Unauthorized(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-semibold">Unauthorized</h1>
        <p className="text-gray-600">You do not have access to this page.</p>
      </div>
    </main>
  );
}


