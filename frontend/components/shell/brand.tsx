import Image from "next/image";
import Link from "next/link";
import { cx } from "../ui";

/** Lotus mark + bilingual wordmark, as on the official logo. `tone` picks text colours for navy or light surfaces. */
export function Brand({ tone = "dark", compact, href = "/" }: { tone?: "dark" | "light"; compact?: boolean; href?: string }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-2.5" aria-label="Samanvay home">
      <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-lg", tone === "dark" ? "bg-white" : "bg-surface")}>
        <Image src="/brand/samanvay-mark.png" alt="" width={34} height={34} priority />
      </span>
      {!compact && (
        <span className="min-w-0 leading-none">
          <span className={cx("flex items-baseline gap-1.5 font-[family-name:var(--font-display)] text-[17px] font-bold tracking-wide", tone === "dark" ? "text-white" : "text-navy")}>
            SAMANVAY
            <span lang="hi" className={cx("font-[family-name:var(--font-deva)] text-[13px] font-semibold tracking-normal", tone === "dark" ? "text-on-navy-muted" : "text-muted")}>समन्वय</span>
          </span>
          <span className={cx("mt-1 block truncate text-[10.5px] font-medium uppercase tracking-[0.08em]", tone === "dark" ? "text-on-navy-muted" : "text-muted")}>
            AICTE · Coordination
          </span>
        </span>
      )}
    </Link>
  );
}

export function BrandStripe({ className }: { className?: string }) {
  return <div className={cx("brand-stripe h-1 w-full", className)} aria-hidden />;
}
