"""Reference categories and the category-compatibility matrix (proposed v0; blueprint Q2/Q6).

Shared by migration 0002 (which seeds them) and the matching benchmark (which must score with the same matrix).
"""

# code, name, name_hi, group, default unit, sensitivity
CATEGORIES = [
    ("GRV_FEE", "Fee refund / excess fee", "शुल्क वापसी / अधिक शुल्क", "GRIEVANCE", "PGRC", "NORMAL"),
    ("GRV_CERTIFICATE", "Withholding of certificates or documents", "प्रमाणपत्र रोकना", "GRIEVANCE", "PGRC", "NORMAL"),
    ("GRV_SCHOLARSHIP", "Scholarship or stipend", "छात्रवृत्ति", "GRIEVANCE", "PGRC", "NORMAL"),
    ("GRV_EXAM", "Examination or results", "परीक्षा / परिणाम", "GRIEVANCE", "PGRC", "NORMAL"),
    (
        "GRV_FACULTY_SERVICE",
        "Faculty salary or service conditions",
        "संकाय वेतन / सेवा शर्तें",
        "GRIEVANCE",
        "PGRC",
        "NORMAL",
    ),
    ("NV_FACULTY", "Faculty shortage or qualification norms", "संकाय की कमी", "NORM_VIOLATION", "RB", "NORMAL"),
    ("NV_INFRA", "Infrastructure, land or building norms", "आधारभूत संरचना मानदंड", "NORM_VIOLATION", "RB", "NORMAL"),
    (
        "NV_CERT_RETENTION",
        "Retention of original certificates / fee demands (APH norm)",
        "मूल प्रमाणपत्र रोकना (मानदंड)",
        "NORM_VIOLATION",
        "RB",
        "NORMAL",
    ),
    (
        "NV_INTAKE",
        "Excess intake or unapproved programme",
        "अधिक प्रवेश / अननुमोदित कार्यक्रम",
        "NORM_VIOLATION",
        "AB",
        "NORMAL",
    ),
    (
        "NV_UNAPPROVED",
        "Unapproved institution or false approval claim",
        "अननुमोदित संस्थान",
        "NORM_VIOLATION",
        "RB",
        "NORMAL",
    ),
    (
        "MAL_FINANCIAL",
        "Capitation fee or financial irregularity",
        "कैपिटेशन शुल्क / वित्तीय अनियमितता",
        "MALPRACTICE",
        "RB",
        "RESTRICTED",
    ),
    ("VIGILANCE", "Vigilance or corruption referral", "सतर्कता संदर्भ", "MALPRACTICE", "RB", "RESTRICTED"),
    ("RAGGING", "Ragging", "रैगिंग", "SAFETY", "ARC", "SEALED"),
    ("HARASSMENT", "Sexual harassment", "यौन उत्पीड़न", "SAFETY", "ARC", "SEALED"),
    ("OTHER", "Other", "अन्य", "GRIEVANCE", "PGRC", "NORMAL"),
]

# Explicit cross-category compatibilities (symmetric). Same code = 1.0, same group = 0.6, otherwise 0.1.
COMPAT_OVERRIDES = {
    ("GRV_CERTIFICATE", "NV_CERT_RETENTION"): 0.9,
    ("GRV_FEE", "NV_CERT_RETENTION"): 0.7,
    ("GRV_FEE", "GRV_CERTIFICATE"): 0.7,
    ("GRV_FEE", "MAL_FINANCIAL"): 0.6,
    ("GRV_FACULTY_SERVICE", "NV_FACULTY"): 0.6,
    ("NV_FACULTY", "NV_CERT_RETENTION"): 0.5,
    ("NV_INTAKE", "NV_UNAPPROVED"): 0.7,
    ("GRV_EXAM", "NV_UNAPPROVED"): 0.3,
    ("RAGGING", "HARASSMENT"): 0.5,
}


def compat_matrix() -> dict[tuple[str, str], float]:
    groups = {c[0]: c[3] for c in CATEGORIES}
    out: dict[tuple[str, str], float] = {}
    for a in groups:
        for b in groups:
            if a == b:
                score = 1.0
            else:
                score = COMPAT_OVERRIDES.get((a, b)) or COMPAT_OVERRIDES.get((b, a))
                if score is None:
                    score = 0.6 if groups[a] == groups[b] else 0.1
            out[(a, b)] = score
    return out
