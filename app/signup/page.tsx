import Link from "next/link";
import { SiteNavbar } from "../../src/components/ui/site-navbar";

export default function SignupPage() {
  return (
    <div className="page-shell pb-12">
      <SiteNavbar />

      <main className="section-wrap pt-6 md:pt-8">
        <section className="grid gap-6 md:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <p className="text-sm font-semibold text-slate-400">
              Get started
            </p>
            <h1 className="heading-font mt-3 text-4xl font-bold text-white">
              Create your AssistDesk account
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-7 text-slate-400">
              Set up your workspace and move into inbox setup, assistant setup,
              and chatbot configuration in the next implementation phase.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="heading-font text-2xl font-bold text-white">
                  Step 1
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Register your account and workspace basics.
                </p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                <p className="heading-font text-2xl font-bold text-white">
                  Step 2
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Create your assistant and attach knowledge sources.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-6 md:p-8">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6">
                <p className="text-sm font-semibold text-slate-400">
                  Sign Up
                </p>
                <h2 className="heading-font mt-2 text-3xl font-bold text-white">
                  Start building your support workspace
                </h2>
              </div>

              <form className="space-y-4">
                <div>
                  <label
                    htmlFor="fullName"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    placeholder="Muhammad Awais"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signupEmail"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Email Address
                  </label>
                  <input
                    id="signupEmail"
                    type="email"
                    placeholder="you@company.com"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="signupPassword"
                    className="mb-2 block text-sm font-medium text-slate-300"
                  >
                    Password
                  </label>
                  <input
                    id="signupPassword"
                    type="password"
                    placeholder="Create a password"
                    className="w-full rounded-2xl border border-white/10 bg-black px-4 py-3 text-white outline-none transition focus:border-white"
                  />
                </div>

                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-white px-6 py-3 font-semibold text-[#050505] transition hover:bg-neutral-200"
                >
                  Create Account
                </button>
              </form>

              <p className="mt-5 text-sm text-slate-400">
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-semibold text-white"
                >
                  Log in
                </Link>
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
