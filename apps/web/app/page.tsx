import Link from "next/link";
import { SiteHeader } from "@/components/site/SiteHeader";
import { buttonVariants } from "@/components/ui/button";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-4 py-16">
        <section className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight">focal</h1>
          <p className="text-lg text-muted-foreground">
            You tell a chat agent what you like. It builds your taste profile. Every site you visit after that shows
            what you care about most first, automatically.
          </p>
          <p className="text-sm text-muted-foreground">
            Same site, same data, your ordering. focal lifts what you'll care about to the top of the lists you already
            browse, says why, and leaves the rest of the page exactly as the site made it.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link className={buttonVariants({})} href="/sign-in">
              Sign in
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/try">
              Try it without installing
            </Link>
            <Link className={buttonVariants({ variant: "outline" })} href="/connect">
              Use it from ChatGPT or Claude
            </Link>
          </div>
        </section>

        <section className="grid gap-6 text-sm sm:grid-cols-3">
          <div>
            <h2 className="mb-1 font-medium">A profile you own</h2>
            <p className="text-muted-foreground">
              Your taste is written by a chat agent — on our site, or from ChatGPT and Claude over MCP. Every change is
              attributed and undoable, and you can export or delete it any time.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-medium">Lifts, not rewrites</h2>
            <p className="text-muted-foreground">
              On lists of things Qloo knows — restaurants, films, books, artists and more — clear matches move to the
              top with a reason, like "Top pick for you". Nothing else changes.
            </p>
          </div>
          <div>
            <h2 className="mb-1 font-medium">Honest limits</h2>
            <p className="text-muted-foreground">
              Chromium browsers only, for now. focal doesn't detect sponsored placements — it only sees the page
              structure and card text it needs to identify the list.
            </p>
          </div>
        </section>

        <p className="text-xs text-muted-foreground">
          <Link className="underline" href="/privacy">
            What focal sees and stores
          </Link>
        </p>
      </main>
    </>
  );
}
