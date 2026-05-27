import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { type CallRow, type CallDetail } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { AppHeader } from "@/components/AppHeader";
import { Phone, ArrowLeft } from "lucide-react";

const NAV_LINKS = [
  { to: "/", label: "Chat" },
  { to: "/memory", label: "Memory" },
];

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(sec: number) {
  if (sec <= 0) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function Calls() {
  const { id } = useParams();
  return (
    <div className="flex h-screen flex-col">
      <AppHeader navLinks={NAV_LINKS} />
      <main className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-2xl">
          {id ? <CallDetailView id={id} /> : <CallList />}
        </div>
      </main>
    </div>
  );
}

function CallList() {
  const api = useApi();
  const { data: calls = [] } = useQuery<CallRow[]>({ queryKey: ["calls"], queryFn: api.getCalls });

  return (
    <>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Calls</h1>
        <p className="mt-2 font-serif text-[1.05rem] leading-relaxed text-muted-foreground">
          Every call, newest first. Open one to see the person's engagement summary and full history.
        </p>
      </header>

      {calls.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
          <Phone className="mx-auto size-7 text-muted-foreground/60" />
          <p className="mt-3 font-serif text-[1.05rem] italic text-muted-foreground">No calls yet.</p>
          <p className="mt-1 text-sm text-muted-foreground/70">
            Ask the assistant to place a call and it'll show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {calls.map((call) => (
            <li key={call.id}>
              <Link
                to={`/calls/${call.id}`}
                className="group flex items-start gap-4 rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <span
                  aria-hidden="true"
                  className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
                >
                  <Phone className="size-4" />
                </span>
                <div className="flex-1">
                  <p className="font-medium text-card-foreground">
                    {call.personEmail ?? call.toNumber ?? "Unknown"}
                  </p>
                  <p className="mt-1 line-clamp-2 font-serif text-[1.02rem] leading-relaxed text-muted-foreground">
                    {call.summary}
                  </p>
                  <p className="mt-2 font-sans text-xs uppercase tracking-[0.1em] text-muted-foreground/70">
                    {formatDuration(call.durationSec)} · {call.status ?? "—"} · {formatDate(call.createdAt)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CallDetailView({ id }: { id: string }) {
  const api = useApi();
  const { data, isLoading } = useQuery<CallDetail>({
    queryKey: ["call", id],
    queryFn: () => api.getCall(id),
  });

  if (isLoading || !data) {
    return <p className="font-serif italic text-muted-foreground">Loading…</p>;
  }

  const summary = data.person?.summary ?? data.call.summary;
  const heading = data.person?.email ?? data.call.personEmail ?? data.call.toNumber ?? "Call";

  return (
    <>
      <Link
        to="/calls"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All calls
      </Link>

      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{heading}</h1>
      </header>

      <section className="mb-10 rounded-2xl border border-border/70 bg-card px-6 py-5 shadow-sm">
        <h2 className="font-sans text-xs uppercase tracking-[0.12em] text-muted-foreground/70">
          Engagement Summary
        </h2>
        <p className="mt-3 font-serif text-[1.05rem] leading-relaxed text-card-foreground">
          {summary || "No summary yet."}
        </p>
      </section>

      <section>
        <h2 className="mb-4 font-sans text-xs uppercase tracking-[0.12em] text-muted-foreground/70">
          Engagement History
        </h2>
        <ol className="space-y-3 border-l border-border/70 pl-5">
          {data.history.map((item) => (
            <li key={item.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[1.43rem] top-2 size-2.5 rounded-full bg-primary/60 ring-4 ring-background"
              />
              <div className="rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-sm">
                <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium text-card-foreground">
                  <Phone className="size-3.5 text-primary" />
                  Phone call
                  <span className="text-muted-foreground/70">· {formatDuration(item.durationSec)}</span>
                  <span className="text-muted-foreground/70">· {formatDate(item.createdAt)}</span>
                  {item.disconnectionReason && (
                    <span className="text-muted-foreground/70">· {item.disconnectionReason}</span>
                  )}
                </p>
                <p className="mt-2 font-serif text-[1.02rem] leading-relaxed text-muted-foreground">
                  {item.summary}
                </p>
                {item.transcript && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm text-primary hover:underline">View log</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-sans text-sm text-muted-foreground">
                      {item.transcript}
                    </pre>
                  </details>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
