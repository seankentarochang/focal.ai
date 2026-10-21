import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function WhyNotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start gap-3 px-6 py-24">
      <h1 className="text-2xl font-semibold text-ink">This explanation isn&apos;t available</h1>
      <p className="text-sm text-muted">
        &ldquo;Why this order?&rdquo; pages last 24 hours and are only visible to the account that ranked the page. Re-run focal on
        the page to get a fresh one.
      </p>
      <Link href="/" className={buttonVariants({ variant: "outline", size: "sm" })}>
        Back to focal
      </Link>
    </main>
  );
}
