"""Synthetic, bilingual, fixed-seed data for the demo and the matching benchmark (blueprint §25.4).

All names, IDs and numbers are fictional. Overlap labels are produced here and written to ml/benchmark/labels.json;
they are never loaded into the application database.
"""

from __future__ import annotations

import datetime as dt
import random
from dataclasses import dataclass, field

SEED = 2026
TODAY = dt.date(2026, 10, 26)

# region id → (state, [cities])
GEOGRAPHY = {
    8: ("Maharashtra", ["Nashik", "Pune", "Mumbai", "Nagpur", "Aurangabad", "Kolhapur"]),
    5: ("Tamil Nadu", ["Chennai", "Coimbatore", "Madurai", "Salem"]),
    6: ("Telangana", ["Hyderabad", "Warangal", "Karimnagar"]),
    7: ("Karnataka", ["Bengaluru", "Mysuru", "Mangaluru", "Belagavi"]),
    3: ("Uttar Pradesh", ["Kanpur", "Lucknow", "Agra", "Varanasi"]),
    4: ("Punjab", ["Ludhiana", "Amritsar", "Jalandhar"]),
    10: ("Haryana", ["Gurugram", "Faridabad", "Rohtak"]),
    1: ("Madhya Pradesh", ["Bhopal", "Indore", "Jabalpur", "Gwalior"]),
    2: ("West Bengal", ["Kolkata", "Durgapur", "Siliguri"]),
    9: ("Assam", ["Guwahati", "Dibrugarh", "Silchar"]),
    11: ("Gujarat", ["Vadodara", "Ahmedabad", "Surat", "Rajkot"]),
    12: ("Kerala", ["Thiruvananthapuram", "Kochi", "Kozhikode"]),
}
PIN_PREFIX = {8: "4", 5: "6", 6: "5", 7: "5", 3: "2", 4: "1", 10: "1", 1: "4", 2: "7", 9: "7", 11: "3", 12: "6"}

ROOTS = [
    "Sahyadri",
    "Shivaji",
    "Vivekananda",
    "Saraswati",
    "Ganga",
    "Krishna",
    "Godavari",
    "Narmada",
    "Kaveri",
    "Tapi",
    "Aravali",
    "Vindhya",
    "Himalaya",
    "Nalanda",
    "Takshashila",
    "Aryabhatta",
    "Ramanujan",
    "Bhaskara",
    "Sri Venkateswara",
    "Sri Sai",
    "Rajarshi Shahu",
    "Lokmanya",
    "Kalinga",
    "Malwa",
    "Deccan",
    "Konkan",
    "Annapurna",
    "Chanakya",
    "Dhanvantari",
    "Gargi",
    "Maitreyi",
    "Panini",
    "Sushruta",
    "Varahamihira",
    "Kautilya",
    "Brahmaputra",
    "Sabarmati",
    "Mahanadi",
    "Chambal",
    "Yamuna",
    "Teesta",
    "Sharavathi",
    "Pamba",
    "Periyar",
    "Nilgiri",
    "Satpura",
    "Ajanta",
    "Ellora",
    "Hampi",
    "Konark",
    "Sanchi",
    "Udaygiri",
    "Shravasti",
    "Vaishali",
]
MIDDLES = ["", "", "", "Valley", "Hills", "Memorial", "Rural", "Global", "Modern", "Royal", "City", "National"]
TYPES = [
    "Institute of Engineering",
    "College of Engineering",
    "Institute of Technology",
    "Institute of Management",
    "College of Pharmacy",
    "Polytechnic",
    "Institute of Engineering and Technology",
    "School of Architecture",
    "College of Engineering and Technology",
    "Institute of Computer Applications",
]
INST_TYPES = {
    "Management": "MANAGEMENT",
    "Pharmacy": "PHARMACY",
    "Polytechnic": "DIPLOMA",
    "Architecture": "ARCHITECTURE",
    "Computer": "MCA",
}

ABBREV = {
    "Institute": ["Inst.", "Instt.", "Institue"],
    "Engineering": ["Engg.", "Engg", "Eng."],
    "Technology": ["Tech.", "Tech"],
    "College": ["Coll.", "Clg"],
    "Management": ["Mgmt."],
    "Pharmacy": ["Pharm."],
    "and": ["&"],
}

FIRST = [
    "Aarav",
    "Vivaan",
    "Aditya",
    "Ishaan",
    "Sai",
    "Ananya",
    "Diya",
    "Priya",
    "Kavya",
    "Meera",
    "Rohan",
    "Kunal",
    "Neha",
    "Pooja",
    "Sneha",
    "Rahul",
    "Amit",
    "Sanjay",
    "Deepa",
    "Lakshmi",
    "Farhan",
    "Zoya",
    "Imran",
    "Simran",
    "Harpreet",
    "Joseph",
    "Mary",
    "Arjun",
    "Ritika",
    "Tanvi",
]
LAST = [
    "Patil",
    "Deshmukh",
    "Kulkarni",
    "Iyer",
    "Reddy",
    "Naidu",
    "Sharma",
    "Verma",
    "Gupta",
    "Singh",
    "Das",
    "Bora",
    "Nair",
    "Menon",
    "Khan",
    "Shaikh",
    "Joshi",
    "Pawar",
    "Chatterjee",
    "Mehta",
    "Patel",
    "Thomas",
    "Gill",
]

PROGRAMMES = [
    ("B.Tech", "बी.टेक"),
    ("MBA", "एमबीए"),
    ("B.Pharm", "बी.फार्म"),
    ("Diploma", "डिप्लोमा"),
    ("M.Tech", "एम.टेक"),
    ("MCA", "एमसीए"),
]

# category → (unit, list of English templates, list of Hindi templates)
TEMPLATES: dict[str, tuple[str, list[str], list[str]]] = {
    "GRV_CERTIFICATE": (
        "PGRC",
        [
            "I completed {prog} in {year} from {inst}, {city}. The institute is withholding my original degree and "
            "marksheets because of a pending fee demand of Rs. {amount}. I have requested them many times since {date}. "
            "Kindly direct the institute to return my certificates.",
            "Respected Sir/Madam, {inst} ({city}) has not returned my original certificates after I finished {prog}. They "
            "say I must first pay Rs {amount} which I do not owe. I need the documents for a job joining on {date}.",
            "My original 10th, 12th and {prog} certificates are kept by {inst}, {city}. The college demands ₹{amount} "
            "before releasing them. This is causing me serious hardship. Please help.",
        ],
        [
            "मैंने {year} में {inst}, {city} से {prog_hi} पूरा किया। संस्थान ₹{amount} शुल्क बकाया बताकर मेरे मूल प्रमाणपत्र "
            "रोक रहा है। {date} से कई बार निवेदन किया है। कृपया प्रमाणपत्र वापस दिलवाएं।",
            "महोदय, {inst} {city} ने {prog_hi} की मेरी मूल डिग्री और अंकपत्र रोक रखे हैं। वे ₹{amount} जमा करने को कह रहे हैं। "
            "कृपया सहायता करें।",
        ],
    ),
    "NV_CERT_RETENTION": (
        "RB",
        [
            "We, the parents' association of {inst}, {city}, report that the institute retains original certificates of "
            "students who have fee arrears, including a demand of Rs. {amount} from {prog} students, and that several "
            "departments run without the prescribed faculty since {date}. We request inspection and action.",
            "Complaint regarding {inst}, {city}: the management keeps original documents of {prog} students as security "
            "and refuses to return them unless Rs {amount} is paid. This is against AICTE norms. Faculty posts are vacant.",
        ],
        [
            "अभिभावक संघ की ओर से शिकायत: {inst}, {city} बकाया शुल्क (₹{amount}) के नाम पर {prog_hi} छात्रों के मूल प्रमाणपत्र "
            "रोक रहा है और कई विभागों में निर्धारित संकाय नहीं है। कृपया निरीक्षण करें।",
        ],
    ),
    "GRV_FEE": (
        "PGRC",
        [
            "I took admission in {prog} at {inst}, {city} and withdrew on {date}. The institute has not refunded my fee of "
            "Rs. {amount} even though I applied within the refund period. Please direct them to refund.",
            "{inst} in {city} charged us Rs {amount} over and above the approved fee for {prog}. No receipt was given. "
            "Students are being harassed for this extra payment.",
        ],
        [
            "मैंने {date} को {inst}, {city} में {prog_hi} से प्रवेश वापस लिया, लेकिन ₹{amount} शुल्क वापस नहीं किया गया। "
            "कृपया शुल्क वापसी करवाएं।",
        ],
    ),
    "GRV_SCHOLARSHIP": (
        "PGRC",
        [
            "The scholarship of Rs. {amount} sanctioned for {prog} students at {inst}, {city} has not been disbursed to us "
            "since {date}. The institute says it has not received the funds.",
        ],
        [
            "{inst}, {city} के {prog_hi} छात्रों की ₹{amount} की छात्रवृत्ति {date} से नहीं मिली है।",
        ],
    ),
    "GRV_EXAM": (
        "PGRC",
        [
            "Results of the {prog} examination held on {date} at {inst}, {city} have been withheld without reason. "
            "Students cannot apply for higher studies.",
        ],
        [],
    ),
    "GRV_FACULTY_SERVICE": (
        "PGRC",
        [
            "I am a faculty member at {inst}, {city}. Salary has not been paid since {date} and the dues are Rs. {amount}. "
            "Several colleagues face the same problem.",
        ],
        [
            "मैं {inst}, {city} में संकाय सदस्य हूँ। {date} से वेतन नहीं मिला है, बकाया ₹{amount} है।",
        ],
    ),
    "NV_FACULTY": (
        "RB",
        [
            "{inst}, {city} runs {prog} with far fewer faculty than the approved strength. Visiting faculty are shown on "
            "paper. We request an inspection.",
            "Faculty shortage at {inst} ({city}): most {prog} classes are taken by final-year students. The approval "
            "documents show faculty who never teach here.",
        ],
        [],
    ),
    "NV_INFRA": (
        "RB",
        [
            "Laboratories and library at {inst}, {city} do not meet AICTE norms. {prog} students have no working "
            "equipment since {date}.",
        ],
        [
            "{inst}, {city} में प्रयोगशाला और पुस्तकालय मानकों के अनुसार नहीं हैं।",
        ],
    ),
    "NV_INTAKE": (
        "AB",
        [
            "{inst}, {city} admitted more students in {prog} than its approved intake this year and runs a programme "
            "not approved by AICTE.",
        ],
        [],
    ),
    "NV_UNAPPROVED": (
        "RB",
        [
            "{inst} in {city} claims AICTE approval for {prog} but is not listed. Students paid Rs. {amount} as fees.",
        ],
        [],
    ),
    "MAL_FINANCIAL": (
        "RB",
        [
            "{inst}, {city} demanded a capitation fee of Rs. {amount} for admission to {prog}. Cash was taken without receipt.",
        ],
        [],
    ),
    "RAGGING": (
        "ARC",
        [
            "Junior students of {prog} at {inst}, {city} are being ragged in the hostel since {date}. The anti-ragging "
            "committee has not acted.",
        ],
        [
            "{inst}, {city} के छात्रावास में {date} से जूनियर छात्रों के साथ रैगिंग हो रही है।",
        ],
    ),
}
CATEGORY_WEIGHTS = {
    "GRV_CERTIFICATE": 16,
    "GRV_FEE": 16,
    "GRV_SCHOLARSHIP": 8,
    "GRV_EXAM": 6,
    "GRV_FACULTY_SERVICE": 7,
    "NV_FACULTY": 10,
    "NV_INFRA": 8,
    "NV_CERT_RETENTION": 5,
    "NV_INTAKE": 5,
    "NV_UNAPPROVED": 4,
    "MAL_FINANCIAL": 4,
    "RAGGING": 3,
}
REGION_RO = {8: "RO-W", 5: "RO-S", 3: "RO-N"}
SUBJECTS = {
    "GRV_CERTIFICATE": "Original certificates withheld",
    "NV_CERT_RETENTION": "Retention of certificates",
    "GRV_FEE": "Fee refund / excess fee",
    "GRV_SCHOLARSHIP": "Scholarship not disbursed",
    "GRV_EXAM": "Results withheld",
    "GRV_FACULTY_SERVICE": "Salary not paid",
    "NV_FACULTY": "Faculty shortage",
    "NV_INFRA": "Infrastructure deficiency",
    "NV_INTAKE": "Excess intake",
    "NV_UNAPPROVED": "Unapproved programme",
    "MAL_FINANCIAL": "Capitation fee demanded",
    "RAGGING": "Ragging in hostel",
}


@dataclass
class SynInstitution:
    permanent_id: str
    name: str
    city: str
    district: str
    state: str
    pin: str
    region_id: int
    inst_type: str
    approval_status: str
    trust_name: str | None
    address: str
    aliases: list[str] = field(default_factory=list)


@dataclass
class SynComplaint:
    key: str
    institution_pid: str
    institution_text: str  # how the complaint names the institution (noisy)
    city_text: str | None
    category: str
    unit: str
    channel: str
    received_on: dt.date
    subject: str
    body: str
    language: str
    complainant_name: str
    complainant_phone: str | None
    complainant_email: str | None
    complainant_type: str
    source_ref: str | None
    matter: str
    kind: str = "background"  # background | dup_multichannel | cpgrams_forward | paraphrase | hindi_english |
    #                            neg_other_matter | neg_sibling


@dataclass
class Dataset:
    institutions: list[SynInstitution]
    complaints: list[SynComplaint]
    positives: list[tuple[str, str, str]]  # (key_a, key_b, injection kind)
    negatives: list[tuple[str, str, str]]  # hard negatives (key_a, key_b, kind)


def _pid(rng: random.Random, used: set[str]) -> str:
    while True:
        pid = f"1-{rng.randint(1000000000, 9989999999)}"
        if pid not in used:
            used.add(pid)
            return pid


def _variant(rng: random.Random, name: str, city: str, strength: int) -> str:
    """A noisy way of writing the institution's name (abbreviations, typos, dropped words, city appended)."""
    words = name.split()
    out = []
    for w in words:
        if w in ABBREV and rng.random() < 0.5 + 0.1 * strength:
            out.append(rng.choice(ABBREV[w]))
        elif w == "of" and rng.random() < 0.25:
            continue
        else:
            out.append(w)
    s = " ".join(out)
    if strength >= 2 and len(s) > 8 and rng.random() < 0.5:
        i = rng.randrange(1, len(s) - 2)
        s = s[:i] + s[i + 1 :] if rng.random() < 0.5 else s[:i] + s[i + 1] + s[i] + s[i + 2 :]
    if strength >= 1 and words[0] in ("Sri", "Rajarshi") and rng.random() < 0.5:
        s = s.replace(words[0] + " ", "", 1)
    if rng.random() < 0.7:
        s = f"{s}, {city}"
    return s


def build_institutions(rng: random.Random) -> list[SynInstitution]:
    used_pid: set[str] = {"1-9990001234", "1-9990001235"}
    used_names: set[tuple[str, str]] = set()
    insts: list[SynInstitution] = []

    def make(
        name: str, region: int, city: str, trust: str | None, status: str = "APPROVED", pid: str | None = None
    ) -> SynInstitution:
        state = GEOGRAPHY[region][0]
        pin = PIN_PREFIX[region] + f"{rng.randint(10000, 99999)}"
        itype = next((v for k, v in INST_TYPES.items() if k in name), "ENGINEERING")
        inst = SynInstitution(
            pid or _pid(rng, used_pid),
            name,
            city,
            city,
            state,
            pin,
            region,
            itype,
            status,
            trust,
            f"Plot {rng.randint(1, 400)}, {rng.choice(['MIDC Road', 'Station Road', 'Ring Road', 'NH 48', 'College Road'])}, {city}",
        )
        abbrev = "".join(w[0] for w in name.split() if w[0].isupper() and w not in ("of", "and"))
        inst.aliases = list(dict.fromkeys([_variant(rng, name, city, 1), abbrev, f"{name}, {city}"]))[:3]
        insts.append(inst)
        used_names.add((name, city))
        return inst

    # Story institutions: one trust, two campuses with the same name (blueprint §27).
    story = make(
        "Sahyadri Valley Institute of Engineering", 8, "Nashik", "Sahyadri Valley Education Trust", pid="1-9990001234"
    )
    story.aliases = [
        "S.V. Inst. of Engg., Nashik",
        "Sahyadri Valley Engg College Nashik",
        "SVIE Nashik",
        "Sahyadri Valley Institute, Nashik",
    ]
    story.pin, story.address = "422101", "Gat No. 112, Trimbak Road, Nashik"
    sib = make(
        "Sahyadri Valley Institute of Engineering", 8, "Pune", "Sahyadri Valley Education Trust", pid="1-9990001235"
    )
    sib.aliases = ["S.V. Inst. of Engg., Pune", "SVIE Pune"]
    sib.pin, sib.address = "411041", "Survey No. 54, Sinhagad Road, Pune"

    regions = list(GEOGRAPHY)
    # 29 more trusts with sibling campuses.
    while len({i.trust_name for i in insts if i.trust_name}) < 30:
        root, mid, typ = rng.choice(ROOTS), rng.choice(MIDDLES), rng.choice(TYPES)
        name = " ".join(x for x in (root, mid, typ) if x)
        region = rng.choice(regions)
        cities = rng.sample(GEOGRAPHY[region][1], 2)
        if any((name, c) in used_names for c in cities):
            continue
        trust = f"{root} {'Education Society' if rng.random() < 0.5 else 'Educational Trust'}"
        for c in cities:
            make(name, region, c, trust)
    while len(insts) < 400:
        root, mid, typ = rng.choice(ROOTS), rng.choice(MIDDLES), rng.choice(TYPES)
        name = " ".join(x for x in (root, mid, typ) if x)
        region = rng.choice(regions)
        city = rng.choice(GEOGRAPHY[region][1])
        if (name, city) in used_names or any(i.name == name for i in insts):
            continue
        status = "APPROVED"
        if len(insts) > 370:
            status = rng.choice(["UNAPPROVED", "CLOSED"])
        make(name, region, city, None, status)
    return insts


def _phone(rng: random.Random) -> str:
    return f"9{rng.randint(100000000, 999999999)}"


def _fill(tpl: str, inst_text: str, city: str, facts: dict) -> str:
    return tpl.format(
        inst=inst_text,
        city=city,
        prog=facts["prog"],
        prog_hi=facts["prog_hi"],
        year=facts["year"],
        amount=f"{facts['amount']:,}",
        date=facts["date"],
    )


def _facts(rng: random.Random, received: dt.date) -> dict:
    prog, prog_hi = rng.choice(PROGRAMMES)
    d = received - dt.timedelta(days=rng.randint(10, 90))
    return {
        "prog": prog,
        "prog_hi": prog_hi,
        "year": received.year - rng.randint(0, 2),
        "amount": rng.choice([15000, 25000, 32500, 40000, 48000, 55000, 62000, 75000, 85000, 120000]),
        "date": d.strftime("%d/%m/%Y"),
    }


def build_dataset(seed: int = SEED, n_complaints: int = 3000) -> Dataset:
    rng = random.Random(seed)
    insts = build_institutions(rng)
    by_pid = {i.permanent_id: i for i in insts}
    siblings: dict[str, list[SynInstitution]] = {}
    for i in insts:
        if i.trust_name:
            siblings.setdefault(i.trust_name, []).append(i)
    complaints: list[SynComplaint] = []
    positives: list[tuple[str, str, str]] = []
    negatives: list[tuple[str, str, str]] = []
    counter = [0]
    cats = list(CATEGORY_WEIGHTS)
    weights = [CATEGORY_WEIGHTS[c] for c in cats]

    def new(
        inst: SynInstitution,
        category: str,
        received: dt.date,
        facts: dict,
        *,
        lang: str = "en",
        tpl_index: int | None = None,
        channel: str | None = None,
        phone: str | None = None,
        name: str | None = None,
        kind: str = "background",
        matter: str | None = None,
        unit: str | None = None,
        body_suffix: str = "",
    ) -> SynComplaint:
        counter[0] += 1
        key = f"K{counter[0]:05d}"
        received = min(received, TODAY)
        default_unit, en, hi = TEMPLATES[category]
        pool = hi if (lang == "hi" and hi) else en
        lang = "hi" if (lang == "hi" and hi) else "en"
        tpl = pool[tpl_index % len(pool)] if tpl_index is not None else rng.choice(pool)
        strength = rng.choice([0, 1, 1, 2])
        inst_text = _variant(rng, inst.name, inst.city, strength).split(",")[0]
        if rng.random() < 0.08:
            inst_text = f"{inst_text} ({inst.permanent_id})"
        body = _fill(tpl, inst_text, inst.city, facts) + body_suffix
        u = unit or default_unit
        if u in ("RB", "PGRC") and inst.region_id in REGION_RO and rng.random() < 0.12 and category.startswith("NV"):
            u = REGION_RO[inst.region_id]
        ch = channel or (
            rng.choice(["CPGRAMS", "CPGRAMS", "EMAIL", "LETTER"])
            if u == "PGRC"
            else rng.choice(["LETTER", "EMAIL", "REFERRAL"])
        )
        ref = f"AICTE/E/{received.year}/{rng.randint(1000000, 9999999):07d}" if ch == "CPGRAMS" else None
        cname = name or f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        subject = {"en": f"{SUBJECTS[category]} — {inst_text}", "hi": f"शिकायत — {inst_text}"}[lang]
        c = SynComplaint(
            key=key,
            institution_pid=inst.permanent_id,
            institution_text=inst_text,
            city_text=inst.city,
            category=category,
            unit=u,
            channel=ch,
            received_on=received,
            subject=subject,
            body=body,
            language=lang,
            complainant_name=cname,
            complainant_phone=phone or _phone(rng),
            complainant_email=None,
            complainant_type=rng.choice(["STUDENT", "STUDENT", "PARENT", "FACULTY"]),
            source_ref=ref,
            matter=matter or key,
            kind=kind,
        )
        complaints.append(c)
        return c

    def rand_date(span: int = 540) -> dt.date:
        return TODAY - dt.timedelta(days=int(rng.triangular(0, span, 60)))

    eligible = [
        i for i in insts if i.permanent_id not in ("1-9990001234", "1-9990001235") and i.approval_status == "APPROVED"
    ]
    bilingual = [c for c in cats if TEMPLATES[c][2]]
    # One matter per (institution, category): two complaints share a slot only when they are the same matter, so the
    # generated labels are unambiguous (otherwise two unrelated look-alike complaints would be labelled "different").
    slots: set[tuple[str, str]] = set()

    def pick(allowed: list[str], fallback: bool = False) -> tuple[SynInstitution, str]:
        for attempt in range(1000):
            choices = cats if (fallback and attempt >= 200) else allowed
            inst, cat = rng.choice(eligible), rng.choice(choices)
            if (inst.permanent_id, cat) not in slots:
                slots.add((inst.permanent_id, cat))
                return inst, cat
        raise RuntimeError("synthetic generator ran out of institution/category slots")

    # Injected true overlaps: 4 kinds × 75.
    for _ in range(75):  # same complainant, two channels / units
        inst, cat = pick(["GRV_CERTIFICATE", "GRV_FEE", "GRV_SCHOLARSHIP", "NV_FACULTY"])
        d = rand_date(400)
        f, phone, nm = _facts(rng, d), _phone(rng), f"{rng.choice(FIRST)} {rng.choice(LAST)}"
        a = new(inst, cat, d, f, phone=phone, name=nm, kind="dup_multichannel", channel="EMAIL")
        b = new(
            inst,
            cat,
            d + dt.timedelta(days=rng.randint(1, 25)),
            f,
            phone=phone,
            name=nm,
            kind="dup_multichannel",
            matter=a.matter,
            channel="CPGRAMS",
            unit="PGRC",
        )
        positives.append((a.key, b.key, "dup_multichannel"))
    for _ in range(75):  # CPGRAMS grievance about a matter RB already holds; RB letter quotes the registration no.
        inst, _ = pick(["GRV_CERTIFICATE"])
        slots.add((inst.permanent_id, "NV_CERT_RETENTION"))
        d = rand_date(400)
        f = _facts(rng, d)
        b = new(inst, "GRV_CERTIFICATE", d, f, kind="cpgrams_forward", channel="CPGRAMS", unit="PGRC")
        a = new(
            inst,
            "NV_CERT_RETENTION",
            d + dt.timedelta(days=rng.randint(5, 40)),
            f,
            kind="cpgrams_forward",
            matter=b.matter,
            unit="RB",
            channel="REFERRAL",
            body_suffix=f" This matter was also raised on CPGRAMS vide {b.source_ref}.",
        )
        positives.append((a.key, b.key, "cpgrams_forward"))
    for _ in range(75):  # same matter, different complainants, paraphrased
        inst, cat = pick([c for c in cats if len(TEMPLATES[c][1]) >= 2])
        d = rand_date(400)
        f = _facts(rng, d)
        a = new(inst, cat, d, f, tpl_index=0, kind="paraphrase")
        b = new(
            inst,
            cat,
            d + dt.timedelta(days=rng.randint(1, 60)),
            f,
            tpl_index=1,
            kind="paraphrase",
            matter=a.matter,
            unit="PGRC" if TEMPLATES[cat][0] == "RB" and rng.random() < 0.5 else None,
        )
        positives.append((a.key, b.key, "paraphrase"))
    for _ in range(75):  # Hindi–English pair, different complainants
        inst, cat = pick(bilingual)
        d = rand_date(400)
        f = _facts(rng, d)
        a = new(inst, cat, d, f, lang="en", kind="hindi_english")
        b = new(
            inst,
            cat,
            d + dt.timedelta(days=rng.randint(1, 45)),
            f,
            lang="hi",
            kind="hindi_english",
            matter=a.matter,
            channel="CPGRAMS",
            unit="PGRC",
        )
        positives.append((a.key, b.key, "hindi_english"))

    # Hard negatives: same institution, different matter; same matter text at a sibling campus.
    for _ in range(150):
        inst, c1 = pick(cats)
        c2 = rng.choice([c for c in cats if c != c1 and (inst.permanent_id, c) not in slots])
        slots.add((inst.permanent_id, c2))
        d = rand_date(400)
        a = new(inst, c1, d, _facts(rng, d), kind="neg_other_matter")
        b = new(inst, c2, d + dt.timedelta(days=rng.randint(1, 90)), _facts(rng, d), kind="neg_other_matter")
        negatives.append((a.key, b.key, "neg_other_matter"))
    trusts = [v for v in siblings.values() if len(v) >= 2 and v[0].permanent_id not in ("1-9990001234", "1-9990001235")]
    for _ in range(150):
        for _ in range(200):
            pair = rng.sample(rng.choice(trusts), 2)
            cat = rng.choice(cats)
            if (pair[0].permanent_id, cat) not in slots and (pair[1].permanent_id, cat) not in slots:
                break
        slots.update({(pair[0].permanent_id, cat), (pair[1].permanent_id, cat)})
        d = rand_date(400)
        f = _facts(rng, d)
        a = new(pair[0], cat, d, f, kind="neg_sibling")
        b = new(pair[1], cat, d + dt.timedelta(days=rng.randint(1, 60)), _facts(rng, d), kind="neg_sibling")
        negatives.append((a.key, b.key, "neg_sibling"))

    while len(complaints) < n_complaints:
        inst, cat = pick([rng.choices(cats, weights)[0]], fallback=True)
        d = rand_date()
        new(inst, cat, d, _facts(rng, d), lang="hi" if rng.random() < 0.15 else "en")

    complaints.sort(key=lambda c: (c.received_on, c.key))
    del by_pid
    return Dataset(insts, complaints, positives, negatives)


# Hand-written story cases for the walkthrough (blueprint §27). Inserted by the demo seed, not by the benchmark.
STORY_CASES = [
    {
        "key": "S1",
        "unit": "RB",
        "officer": "neha.iyer",
        "pid": "1-9990001234",
        "category": "NV_CERT_RETENTION",
        "channel": "LETTER",
        "received_on": dt.date(2026, 9, 2),
        "status": "ACTION_INITIATED",
        "subject": "Parents' association: certificates withheld and faculty shortage — Sahyadri Valley Institute of "
        "Engineering, Nashik",
        "body": "The parents' association of Sahyadri Valley Institute of Engineering, Nashik reports that the institute "
        "retains the original degree certificates of B.Tech students with fee arrears (a demand of Rs. 40,000 "
        "per student) and that the Mechanical and Civil departments run without the prescribed faculty since "
        "15/06/2026. An expert committee visited on 24/09/2026 and confirmed the faculty shortage. A show-cause "
        "notice is being drafted.",
        "complainant": ("Parents' Association, SVIE", "9822000111"),
        "next_action": "Draft show-cause notice",
    },
    {
        "key": "S2",
        "unit": "RO-W",
        "officer": "fernandes",
        "pid": "1-9990001234",
        "category": "NV_INFRA",
        "channel": "EMAIL",
        "received_on": dt.date(2026, 9, 18),
        "status": "REGISTERED",
        "subject": "Laboratory and library deficiencies — Sahyadri Valley Institute of Engineering, Nashik",
        "body": "Students of Sahyadri Valley Institute of Engineering, Nashik report that the electronics laboratory has "
        "had no working oscilloscopes since July and the library subscription lapsed. They request the Western "
        "Regional Office to verify infrastructure norms.",
        "complainant": ("Student Council, SVIE", "9822000222"),
        "next_action": "Schedule verification visit",
    },
    {
        "key": "S3",
        "unit": "PGRC",
        "officer": "arjun.sharma",
        "pid": "1-9990001234",
        "category": "GRV_FEE",
        "channel": "CPGRAMS",
        "received_on": dt.date(2025, 11, 3),
        "status": "DISPOSED",
        "disposed_on": dt.date(2025, 11, 20),
        "source_ref": "AICTE/E/2025/0098765",
        "subject": "Fee refund after withdrawal — Sahyadri Valley Institute of Engineering, Nashik",
        "body": "I withdrew from the B.Tech programme at Sahyadri Valley Institute of Engineering, Nashik on 12/08/2025 "
        "and the institute has not refunded Rs. 62,000. (Disposed: refund made on 18/11/2025.)",
        "complainant": ("Rohan Deshmukh", "9890011223"),
    },
    {
        "key": "S4",
        "unit": "PGRC",
        "officer": "arjun.sharma",
        "pid": "1-9990001235",
        "category": "GRV_CERTIFICATE",
        "channel": "CPGRAMS",
        "received_on": dt.date(2026, 10, 6),
        "status": "UNDER_EXAMINATION",
        "source_ref": "AICTE/E/2026/0011987",
        "subject": "Original certificates withheld — Sahyadri Valley Institute of Engineering, Pune",
        "body": "Sahyadri Valley Institute of Engineering, Pune campus is withholding my original diploma certificate "
        "because of a hostel fee dispute of Rs. 18,000. I completed the Diploma in 2025.",
        "complainant": ("Meera Kulkarni", "9765400112"),
    },
    {
        "key": "S5",
        "unit": "PGRC",
        "officer": "arjun.sharma",
        "pid": "1-9990001234",
        "category": "GRV_SCHOLARSHIP",
        "channel": "EMAIL",
        "received_on": dt.date(2026, 10, 9),
        "status": "AWAITING_INFORMATION",
        "subject": "Scholarship not disbursed — Sahyadri Valley Institute of Engineering, Nashik",
        "body": "The post-matric scholarship for MBA students at Sahyadri Valley Institute of Engineering, Nashik has not "
        "been credited since April 2026. The institute says the state portal is pending.",
        "complainant": ("Farhan Shaikh", "9011223344"),
        "next_action": "Await institute's reply",
    },
]

# The live demo complaint (blueprint §27 step 1): entered by the PGRC intake officer during the demo.
STORY_LIVE_CPGRAMS = {
    "source_ref": "AICTE/E/2026/0012345",
    "received_on": "2026-10-14",
    "institution_name": "सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक",
    "subject": "मूल डिग्री प्रमाणपत्र रोका गया — सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग",
    "body": "महोदय, मैंने 2026 में सह्याद्री वैली इंस्टीट्यूट ऑफ इंजीनियरिंग, नासिक (S.V. Inst. of Engg.) से बी.टेक "
    "पूरा किया। संस्थान ₹40,000 शुल्क बकाया बताकर मेरी मूल डिग्री और अंकपत्र रोक रहा है। कई बार निवेदन के "
    "बाद भी प्रमाणपत्र नहीं दिए गए। कृपया संस्थान को प्रमाणपत्र लौटाने का निर्देश दें। CPGRAMS पंजीकरण "
    "संख्या AICTE/E/2026/0012345",
    "category_code": "GRV_CERTIFICATE",
    "channel": "CPGRAMS",
}
