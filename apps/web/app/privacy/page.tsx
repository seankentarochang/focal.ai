import { SiteHeader } from "@/components/site/SiteHeader";

const NEVER_RUN = ["banking", "health", "government", "email", "messaging", "documents", "passwords", "sign-in", "focal"];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-medium">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10 text-sm">
        <h1 className="text-2xl font-semibold">What focal sees and stores</h1>

        <Section title="What leaves your browser">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              On a <strong>new site layout</strong>, the extension sends each list card's short text snippets (at most 6
              per card, 80 characters each, and at most 60 cards) plus the site's hostname, path pattern and up to 5
              city hints to TypeSafe (Jev) for list identification. Every rank request also carries the page's hostname,
              which the server keeps for 24 hours with the stored page result. The structure-only page signature
              goes only to the focal server. Never full pages, screenshots, or form field contents — except a city taken from a location box or an {"in <city>"} phrase in a search box.
            </li>
            <li>
              On a <strong>known layout</strong>, only item names, the entity type, and the city go to the focal server.
            </li>
            <li>
              Item names and the page's city go to <strong>Qloo</strong> for entity resolution; resolved entity and
              tag ids go to Qloo's insights API for affinity scoring.
            </li>
            <li>
              <strong>Chat text and your taste-profile summary</strong> are processed by the LLM providers behind
              the site chat — Groq first, then Cerebras, then OpenRouter; some of them log prompts.
            </li>
          </ul>
        </Section>

        <Section title="What the server stores">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Your account, taste profile, activity feed, and site settings.</li>
            <li>Page results for 24 hours — they power feedback and the "Why this order?" inspector, then expire.</li>
            <li>Learned layouts live only in your browser's extension storage — the server never stores them.</li>
            <li>A shared entity-resolution cache keyed by normalized item name, type, and city; resolved entries do not expire. It is not tied to your browsing.</li>
          </ul>
          <p className="text-muted-foreground">No browsing history. No passive tracking of sites you visit.</p>
        </Section>

        <Section title="Where focal never runs">
          <p className="text-muted-foreground">
            Built-in categories: {NEVER_RUN.join(", ")}. Plus anywhere you add to your skip list, pages with password or
            payment fields, and incognito windows.
          </p>
        </Section>

        <Section title="Your controls">
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>Every write to your profile is attributed (chat, page, manual, or an MCP assistant) and undoable.</li>
            <li>Hard rules need your explicit approval. MCP assistants cannot change your settings.</li>
            <li>Export everything from Settings → Export my data, at any time.</li>
            <li>
              Delete the account — profile, activity, settings, sessions — from{" "}
              <a className="underline" href="/settings">
                Settings
              </a>
              , at any time.
            </li>
            <li>API keys (Qloo, TypeSafe, LLM providers) live only on the server and never reach the extension.</li>
          </ul>
        </Section>
      </main>
    </>
  );
}
