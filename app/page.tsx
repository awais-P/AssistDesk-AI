import Link from "next/link";
import { SiteNavbar } from "../src/components/ui/site-navbar";

export default function Home() {
  return (
    <div className="page-shell pb-12">
      <SiteNavbar />

      <main className="section-wrap flex flex-col gap-16 pt-10 md:gap-24 md:pt-16">
        <section>
          <div className="grid items-center gap-10 lg:grid-cols-[1.12fr_0.88fr] lg:gap-14">
            <div className="flex flex-col gap-6">
              <span className="w-fit rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold text-white md:text-sm">
                Omnichannel support for modern businesses
              </span>

              <div className="space-y-4">
                <h1 className="heading-font max-w-4xl text-[2.5rem] font-bold leading-[1.02] text-white md:text-[3.65rem] xl:text-[4.25rem]">
                  AssistDesk helps teams manage support, knowledge, and AI chat
                  in one place.
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-300 md:text-base">
                  Build your support inbox, train your assistant with company
                  knowledge, and deploy a clean web widget experience without
                  making customers jump between tools.
                </p>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/signup"
                  className="pressable inline-flex min-w-[132px] items-center justify-center rounded-xl bg-white px-5 py-2.5 text-center text-sm font-semibold text-[#050505] transition hover:bg-neutral-200"
                >
                  Start Free
                </Link>
                <Link
                  href="/login"
                  className="pressable inline-flex min-w-[132px] items-center justify-center rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-center text-sm font-semibold text-white transition hover:bg-white/8"
                >
                  Log In
                </Link>
              </div>

              <div className="grid gap-4 pt-2 md:grid-cols-3">
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="heading-font text-xl font-bold text-white md:text-[1.65rem]">
                    24/7
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Always-on support experience for website visitors.
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="heading-font text-xl font-bold text-white md:text-[1.65rem]">
                    1 Hub
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Dashboard for agent setup, sources, and future tickets.
                  </p>
                </div>
                <div className="rounded-[22px] border border-white/10 bg-white/[0.03] p-5">
                  <p className="heading-font text-xl font-bold text-white md:text-[1.65rem]">
                    Smart
                  </p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Simple AI-powered replies connected to your knowledge base.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center">
              <div className="w-full rounded-[24px] border border-white/10 bg-black/40 p-5 text-white shadow-[0_0_60px_rgba(37,99,235,0.1)] xl:p-6">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-xs text-slate-400 md:text-sm">Live Preview</p>
                    <h2 className="heading-font text-lg font-semibold md:text-xl">
                      Support Widget
                    </h2>
                  </div>
                  <span className="rounded-full border border-white/10 bg-white/6 px-3 py-1 text-xs font-semibold text-white">
                    Online
                  </span>
                </div>

                <div className="space-y-3 py-4 text-sm leading-6">
                  <div className="max-w-[85%] rounded-3xl rounded-tl-sm bg-white/10 px-4 py-3">
                    Hello. I need help with account setup.
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-3xl rounded-tr-sm bg-white px-4 py-3 text-black">
                    Welcome to AssistDesk. I can guide you through setup and
                    share answers from your support knowledge base.
                  </div>
                  <div className="max-w-[85%] rounded-3xl rounded-tl-sm bg-white/10 px-4 py-3">
                    Can I upload documents for training?
                  </div>
                  <div className="ml-auto max-w-[85%] rounded-3xl rounded-tr-sm bg-white px-4 py-3 text-black">
                    Yes. You can add files, website links, and custom text
                    directly from the dashboard.
                  </div>
                </div>

                <div className="rounded-[20px] border border-white/10 bg-white/4 p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-300">
                    Quick Overview
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-slate-300">Knowledge Base</p>
                      <p className="mt-1 font-medium text-white">Files, URLs, raw text</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <p className="text-xs text-slate-300">Sessions</p>
                      <p className="mt-1 font-medium text-white">Stored chat history</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm font-semibold text-slate-400">
              Module 7
            </p>
            <h3 className="heading-font mt-3 text-lg font-semibold text-white md:text-xl">
              User Dashboard
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              A single place to manage assistants, review setup progress, and
              move between the main product areas.
            </p>
          </article>

          <article className="rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm font-semibold text-slate-400">
              Module 10
            </p>
            <h3 className="heading-font mt-3 text-lg font-semibold text-white md:text-xl">
              Knowledge Base
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              Upload support material and organize assistant training data with
              a straightforward interface.
            </p>
          </article>

          <article className="rounded-[20px] border border-white/10 bg-white/[0.03] p-6">
            <p className="text-sm font-semibold text-slate-400">
              Module 1 + 5
            </p>
            <h3 className="heading-font mt-3 text-lg font-semibold text-white md:text-xl">
              Web Chat Flow
            </h3>
            <p className="mt-3 text-sm leading-7 text-slate-400">
              Configure the assistant and connect it to a web experience with
              basic chat sessions and saved history.
            </p>
          </article>
        </section>

        <section
          id="about"
          className="grid gap-8 border-t border-white/10 pt-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-12"
        >
          <div>
            <p className="text-sm font-semibold text-slate-400">
              Why AssistDesk
            </p>
            <h2 className="heading-font mt-3 max-w-xl text-[1.9rem] font-bold text-white md:text-[2.35rem] xl:text-[2.85rem]">
              Simple enough for a first release, strong enough for the final
              vision.
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
                <h3 className="heading-font text-lg font-semibold text-white">
                  Clean onboarding
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  New teams can create an inbox, define an assistant, and set
                  up the chatbot without a cluttered workflow.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
                <h3 className="heading-font text-lg font-semibold text-white">
                  Organized knowledge
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  Documents and website content can be managed from one place
                  for a more consistent support assistant.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
                <h3 className="heading-font text-lg font-semibold text-white">
                  Better customer flow
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  The landing page and widget style make the platform feel like
                  a real product during evaluation.
                </p>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-5">
                <h3 className="heading-font text-lg font-semibold text-white">
                  Ready to grow
                </h3>
                <p className="mt-2 text-sm leading-7 text-slate-400">
                  This foundation can later expand into tickets, escalation,
                  analytics, and omnichannel integrations.
                </p>
              </div>
          </div>
        </section>
      </main>
    </div>
  );
}
