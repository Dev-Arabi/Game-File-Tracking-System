import Link from 'next/link'

export default function Page() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-6 text-foreground">
      {/* keyframes for the whole HUD motion system */}
      <style>{`
        @keyframes radarSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes travelRight {
          0% { transform: translate(-50%, -50%) translateX(-150px); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate(-50%, -50%) translateX(150px); opacity: 0; }
        }
        @keyframes travelDown {
          0% { transform: translate(-50%, -50%) translateY(-150px); opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { transform: translate(-50%, -50%) translateY(150px); opacity: 0; }
        }
        @keyframes floatParticle {
          0% { transform: translateY(0) scale(1); opacity: 0; }
          12% { opacity: .9; }
          88% { opacity: 0; }
          100% { transform: translateY(-140px) scale(0.6); opacity: 0; }
        }
        @keyframes flickerIn {
          0% { opacity: 0; }
          6% { opacity: 1; }
          11% { opacity: .15; }
          16% { opacity: 1; }
          22% { opacity: .35; }
          32% { opacity: 1; }
          100% { opacity: 1; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes bracketDraw {
          from { opacity: 0; transform: scale(0.4); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes scanline {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(120%); }
        }
        @keyframes pulseRing {
          0% { transform: scale(0.85); opacity: .7; }
          100% { transform: scale(1.9); opacity: 0; }
        }
      `}</style>

      {/* base grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(hsl(var(--border)/0.22)_1px,transparent_1px),linear-gradient(90deg,hsl(var(--border)/0.22)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_78%)]"
      />

      {/* crosshair lines */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-px w-[min(85vw,34rem)] -translate-x-1/2 -translate-y-1/2 bg-primary/30 shadow-[0_0_18px_hsl(var(--primary)/0.55)]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[min(85vw,34rem)] w-px -translate-x-1/2 -translate-y-1/2 bg-primary/20"
      />

      {/* traveling signal blips riding the crosshair */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_2px_hsl(var(--primary)/0.8)] motion-safe:animate-[travelRight_5s_ease-in-out_infinite]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_10px_2px_hsl(var(--primary)/0.8)] motion-safe:animate-[travelDown_6.5s_ease-in-out_infinite]"
        style={{ animationDelay: '1.1s' }}
      />

      {/* ambient drifting particles */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        {[
          { left: '22%', bottom: '18%', delay: '0s', dur: '7s' },
          { left: '78%', bottom: '24%', delay: '1.8s', dur: '8.5s' },
          { left: '35%', bottom: '10%', delay: '3.2s', dur: '6.2s' },
          { left: '64%', bottom: '14%', delay: '4.6s', dur: '9s' },
          { left: '50%', bottom: '30%', delay: '2.4s', dur: '7.8s' },
        ].map((p, i) => (
          <span
            key={i}
            className="absolute h-1 w-1 rounded-full bg-primary/70 motion-safe:animate-[floatParticle_linear_infinite]"
            style={{ left: p.left, bottom: p.bottom, animationDelay: p.delay, animationDuration: p.dur }}
          />
        ))}
      </div>

      <section className="relative flex w-full max-w-md flex-col items-center text-center">
        {/* HUD corner brackets */}
        {[
          'left-0 top-0 border-l border-t',
          'right-0 top-0 border-r border-t',
          'left-0 bottom-0 border-l border-b',
          'right-0 bottom-0 border-r border-b',
        ].map((pos, i) => (
          <span
            key={pos}
            aria-hidden="true"
            className={`pointer-events-none absolute h-5 w-5 border-primary/50 motion-safe:animate-[bracketDraw_0.5s_ease-out_backwards] ${pos}`}
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}

        <div
          className="mb-7 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground opacity-0 motion-safe:animate-[fadeUp_0.6s_ease-out_forwards]"
        >
          <span className="h-px w-8 bg-primary" />
          <span>Mission control</span>
          <span className="h-px w-8 bg-primary" />
        </div>

        <div
          className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/60 bg-card shadow-[0_0_28px_hsl(var(--primary)/0.2)] opacity-0 motion-safe:animate-[flickerIn_0.9s_ease-out_forwards]"
          style={{ animationDelay: '150ms' }}
        >
          {/* radar sweep ring behind the badge */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-3 rounded-full motion-safe:animate-[radarSpin_4s_linear_infinite] [background-image:conic-gradient(from_0deg,transparent_0deg,hsl(var(--primary)/0.45)_16deg,transparent_55deg)]"
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -inset-3 rounded-full border border-primary/15 motion-safe:animate-[pulseRing_2.4s_ease-out_infinite]"
          />
          <div className="absolute inset-2 rounded-xl border border-primary/20" />
          <span className="font-mono text-xl font-bold text-primary" aria-hidden="true">FT</span>
          <span className="sr-only">File Tracker</span>
        </div>

        <p
          className="mb-3 font-mono text-[11px] uppercase tracking-[0.28em] text-primary opacity-0 motion-safe:animate-[fadeUp_0.6s_ease-out_forwards]"
          style={{ animationDelay: '300ms' }}
        >
          Player operations // online
        </p>

        <h1
          className="text-balance text-5xl font-bold tracking-[-0.04em] opacity-0 motion-safe:animate-[fadeUp_0.6s_ease-out_forwards]"
          style={{ animationDelay: '420ms' }}
        >
          File Tracker
        </h1>

        <p
          className="mt-4 max-w-sm text-pretty text-sm leading-6 text-muted-foreground opacity-0 motion-safe:animate-[fadeUp_0.6s_ease-out_forwards]"
          style={{ animationDelay: '560ms' }}
        >
          Track assignments. Upload progress. Keep every mission on target.
        </p>

        <Link
          href="/auth/login"
          className="group relative mt-8 inline-flex min-h-12 items-center gap-3 overflow-hidden rounded-lg border border-primary bg-primary px-7 font-mono text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground opacity-0 shadow-[0_0_24px_hsl(var(--primary)/0.28)] transition-all motion-safe:animate-[fadeUp_0.6s_ease-out_forwards] hover:-translate-y-0.5 hover:shadow-[0_0_34px_hsl(var(--primary)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          style={{ animationDelay: '720ms' }}
        >
          {/* scanline sweep on hover */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-primary-foreground/25 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 motion-safe:group-hover:animate-[scanline_1s_ease-in-out_infinite]"
          />
          {/* targeting reticle corners on hover */}
          <span aria-hidden="true" className="pointer-events-none absolute -left-1 -top-1 h-2 w-2 border-l-2 border-t-2 border-primary-foreground opacity-0 scale-50 transition-all duration-200 group-hover:opacity-80 group-hover:scale-100" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-1 -top-1 h-2 w-2 border-r-2 border-t-2 border-primary-foreground opacity-0 scale-50 transition-all duration-200 group-hover:opacity-80 group-hover:scale-100" />
          <span aria-hidden="true" className="pointer-events-none absolute -left-1 -bottom-1 h-2 w-2 border-l-2 border-b-2 border-primary-foreground opacity-0 scale-50 transition-all duration-200 group-hover:opacity-80 group-hover:scale-100" />
          <span aria-hidden="true" className="pointer-events-none absolute -right-1 -bottom-1 h-2 w-2 border-r-2 border-b-2 border-primary-foreground opacity-0 scale-50 transition-all duration-200 group-hover:opacity-80 group-hover:scale-100" />

          <span className="h-2 w-2 rounded-full bg-primary-foreground transition-transform group-hover:scale-125" />
          Press Here
          <span aria-hidden="true" className="text-base leading-none transition-transform group-hover:translate-x-1">→</span>
        </Link>

        <p
          className="mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70 opacity-0 motion-safe:animate-[fadeUp_0.6s_ease-out_forwards]"
          style={{ animationDelay: '850ms' }}
        >
          Secure access // v1.0
        </p>
      </section>
    </main>
  )
}