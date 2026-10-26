"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EvidenceList } from "@/components/status";
import { Require } from "@/components/require";
import { Button, Card, ErrorNote, Field, PageHeader, inputCls, cx } from "@/components/ui";
import { api, useApi } from "@/lib/api";
import { CHANNEL_LABEL } from "@/lib/format";
import { useSession, useUnsavedChanges } from "@/lib/session";
import type { Meta, Reason } from "@/lib/types";

type Candidate = { institution_id: string; permanent_id: string; name: string; city: string | null; state: string | null; approval_status: string; probability: number; reasons: Reason[] };
type Resolution = { status: "RESOLVED" | "PENDING" | "UNRESOLVED"; probability: number; institution_id: string | null; candidates: Candidate[]; note: string };

// The walkthrough's live CPGRAMS grievance (blueprint §27, step 1), also in samples/story_cpgrams_hindi.txt.
const STORY = {
  channel: "CPGRAMS", category_code: "GRV_CERTIFICATE", received_on: "2026-10-14", source_ref: "AICTE/E/2026/0012345",
  institution_name: "सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक", institution_city: "",
  subject: "मूल डिग्री प्रमाणपत्र रोका गया — सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग",
  body: "महोदय, मैंने 2026 में सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक (S.V. Inst. of Engg.) से बी.टेक पूरा किया। संस्थान ₹40,000 शुल्क बकाया बताकर मेरी मूल डिग्री और अंकपत्र रोक रहा है। कई बार निवेदन के बाद भी प्रमाणपत्र नहीं दिए गए। कृपया संस्थान को प्रमाणपत्र लौटाने का निर्देश दें। CPGRAMS पंजीकरण संख्या AICTE/E/2026/0012345",
  complainant_name: "Priya Patil", complainant_phone: "9876501234", complainant_type: "STUDENT",
};

const EMPTY = {
  channel: "EMAIL", category_code: "", received_on: new Date().toISOString().slice(0, 10), source_ref: "", institution_name: "",
  institution_city: "", subject: "", body: "", complainant_name: "", complainant_phone: "", complainant_type: "STUDENT",
};

function NewCase() {
  const router = useRouter();
  const { me } = useSession();
  const { data: meta } = useApi<Meta>("/meta");
  const [f, setF] = useState(EMPTY);
  const [res, setRes] = useState<Resolution | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [dupe, setDupe] = useState<string | null>(null);

  useUnsavedChanges("new-case", !busy && (f.subject !== "" || f.body !== "" || f.institution_name !== ""));
  const nameReady = f.institution_name.trim().length >= 3;
  useEffect(() => {
    if (!nameReady) return;
    const id = setTimeout(() => {
      api<Resolution>("/institutions/resolve", { json: { name: f.institution_name, city: f.institution_city || null } })
        .then((r) => {
          setRes(r);
          setPicked(r.status === "RESOLVED" ? r.institution_id : null);
        })
        .catch(() => setRes(null));
    }, 400);
    return () => clearTimeout(id);
  }, [f.institution_name, f.institution_city, nameReady]);
  const shown = nameReady ? res : null;

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries({ ...f, institution_id: picked }).filter(([, v]) => v !== "" && v !== null));
      const out = await api<{ created: boolean; case: { case_no: string } }>("/cases", { json: body, headers: { "idempotency-key": crypto.randomUUID() } });
      if (!out.created) setDupe(out.case.case_no);
      else router.push(`/cases/${out.case.case_no}?new=1`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Register a complaint" crumbs={[{ label: "All Cases", href: "/cases" }, { label: "New case" }]}
        description="Seven fields are mandatory. The institution is resolved as you type; references (CPGRAMS number, Permanent ID, court case) are read from the text automatically."
        actions={me?.demo_mode && <Button variant="secondary" onClick={() => setF(STORY)}>Load demo CPGRAMS grievance (Hindi)</Button>} />
      {dupe && (
        <Card>
          <p className="font-bold">Already registered</p>
          <p className="text-sm">A case with this channel and reference exists: <Link className="font-mono font-bold underline" href={`/cases/${dupe}`}>{dupe}</Link>. No duplicate was created.</p>
        </Card>
      )}
      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Channel" required>
              <select className={inputCls} value={f.channel} onChange={set("channel")}>
                {(meta?.channels ?? ["EMAIL"]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c] ?? c}</option>)}
              </select>
            </Field>
            <Field label="Received on" required><input type="date" className={inputCls} value={f.received_on} onChange={set("received_on")} required /></Field>
            <Field label={f.channel === "CPGRAMS" ? "CPGRAMS registration no." : "Source reference"} hint="Used to stop duplicates">
              <input className={inputCls} value={f.source_ref} onChange={set("source_ref")} placeholder={f.channel === "CPGRAMS" ? "AICTE/E/2026/…" : "Diary / letter no."} />
            </Field>
          </div>
          <Field label="Category" required>
            <select className={inputCls} value={f.category_code} onChange={set("category_code")} required>
              <option value="">Choose a category</option>
              {meta?.categories.map((c) => (
                <option key={c.code} value={c.code}>{c.name}{c.sensitivity !== "NORMAL" ? ` (${c.sensitivity.toLowerCase()})` : ""}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <Field label="Institution (as written in the complaint)" required><input className={inputCls} value={f.institution_name} onChange={set("institution_name")} required /></Field>
            <Field label="City / district"><input className={inputCls} value={f.institution_city} onChange={set("institution_city")} /></Field>
          </div>
          <Field label="Subject" required><input className={inputCls} value={f.subject} onChange={set("subject")} required minLength={3} maxLength={300} /></Field>
          <Field label="Complaint text" required hint="Kept inside AICTE systems; never sent to an external AI service.">
            <textarea className={cx(inputCls, "min-h-40")} value={f.body} onChange={set("body")} required minLength={10} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Complainant name" hint="Stored encrypted"><input className={inputCls} value={f.complainant_name} onChange={set("complainant_name")} /></Field>
            <Field label="Phone" hint="Hashed for duplicate detection"><input className={inputCls} value={f.complainant_phone} onChange={set("complainant_phone")} inputMode="tel" /></Field>
            <Field label="Complainant type">
              <select className={inputCls} value={f.complainant_type} onChange={set("complainant_type")}>
                {(meta?.complainant_types ?? []).map((c) => <option key={c} value={c}>{c.toLowerCase()}</option>)}
              </select>
            </Field>
          </div>
          <ErrorNote error={error} />
          <div><Button type="submit" busy={busy}>Register case</Button></div>
        </Card>

        <Card className="flex h-fit flex-col gap-3 xl:sticky xl:top-20" title="Institution resolver" description="Matches from the AICTE master. Sibling campuses are shown, never merged.">
          {!shown && <p className="text-sm text-muted">Type the institution&apos;s name to see matches from the AICTE master.</p>}
          {shown && (
            <>
              <p className={cx("rounded-lg px-3 py-2 text-sm font-semibold", shown.status === "RESOLVED" ? "bg-ok-soft text-ok-ink" : "bg-warn-soft text-warn-ink")}>{shown.note}</p>
              <ul className="flex flex-col gap-2">
                {shown.candidates.map((c) => (
                  <li key={c.institution_id}>
                    <button type="button" onClick={() => setPicked(picked === c.institution_id ? null : c.institution_id)} aria-pressed={picked === c.institution_id}
                      className={cx("w-full rounded-lg border p-3 text-left transition", picked === c.institution_id ? "border-action bg-action-soft/40 ring-2 ring-action" : "border-rule bg-surface hover:border-navy/40")}>
                      <span className="flex items-start justify-between gap-2">
                        <span><span className="block text-sm font-bold">{c.name}</span><span className="text-xs text-muted">{c.city}, {c.state} · {c.permanent_id}</span></span>
                        <span className="rounded-md bg-navy px-2 py-0.5 text-xs font-semibold text-white tabular">{c.probability.toFixed(2)}</span>
                      </span>
                      <span className="mt-2 block"><EvidenceList reasons={c.reasons} compact /></span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">{picked ? "The selected institution will be recorded as officer-confirmed." : "No institution selected: the case is saved as ‘received’ and waits for confirmation."}</p>
            </>
          )}
        </Card>
      </form>
    </div>
  );
}

export default function NewCasePage() {
  return <Require cap="cases.create"><NewCase /></Require>;
}
