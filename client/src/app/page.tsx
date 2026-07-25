import { ArrowRight, Shield } from 'lucide-react'
import Link from 'next/link'

export default function HomePage() {
  return (
    <main className="grid min-h-screen place-items-center bg-[--ink-900] px-6">
      <section className="w-full max-w-xl border border-[--ink-600] bg-[--ink-850] p-8">
        <Shield className="text-[--gold-400]" size={30} strokeWidth={1.5} />
        <p className="type-micro mt-8 text-[--gold-400]">Karnataka State Police</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-[--txt-hi]">
          KSPCID
        </h1>
        <p className="mt-3 max-w-md text-sm text-[--txt-2]">
          Crime Intelligence &amp; Analytical Platform · State Crime Records Bureau
        </p>
        <Link
          href="/map/"
          className="mt-8 inline-flex items-center gap-2 rounded-[--r-sm] bg-[--gold-400] px-4 py-2.5 text-sm font-semibold text-[--ink-900]"
        >
          Open command wall <ArrowRight size={16} />
        </Link>
      </section>
    </main>
  )
}
