export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col gap-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">VocaFlow</h1>
          <p className="text-base text-muted-foreground">Voice Calendar Agent</p>
        </header>

        <section className="grid flex-1 gap-4 md:grid-cols-[1fr_1.4fr]">
          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground">
              Voice/Input Area
            </h2>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-sm font-medium text-muted-foreground">
              Calendar Area
            </h2>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 md:col-span-2">
            <h2 className="text-sm font-medium text-muted-foreground">
              Result Area
            </h2>
          </div>
        </section>
      </div>
    </main>
  );
}
