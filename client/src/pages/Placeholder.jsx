export default function Placeholder({ title, message }) {
  return (
    <div className="space-y-6">
      <section>
        <p className="text-sm font-medium text-accent">Planned stage</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
      </section>
      <div className="rounded-xl border border-dashed border-line bg-panel/50 p-8 text-neutral-400">
        {message}
      </div>
    </div>
  );
}

