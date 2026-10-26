"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { SnapshotView } from "@/components/reports";

export default function SnapshotPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="flex flex-col gap-4">
      <Link href="/reports/snapshots" className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-action hover:underline"><ArrowLeft size={15} aria-hidden />All snapshots</Link>
      <SnapshotView id={id} />
    </div>
  );
}
