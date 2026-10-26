/**
 * UI strings for English and Hindi. Navigation, page titles and common actions are translated; complaint content is
 * shown as received. Add a key here and read it with `t(key)` from useSession().
 */
export type Lang = "en" | "hi";

export const STRINGS = {
  // navigation groups
  "group.workspace": { en: "Workspace", hi: "कार्यक्षेत्र" },
  "group.institutions": { en: "Institutions", hi: "संस्थान" },
  "group.insights": { en: "Insights", hi: "विश्लेषण" },
  "group.system": { en: "System", hi: "प्रणाली" },
  // navigation items / page titles
  "nav.desk": { en: "Bureau Desk", hi: "ब्यूरो डेस्क" },
  "nav.worklist": { en: "My Worklist", hi: "मेरी कार्य सूची" },
  "nav.cases": { en: "All Cases", hi: "सभी मामले" },
  "nav.coordination": { en: "Coordination Centre", hi: "समन्वय केंद्र" },
  "nav.transfers": { en: "Transfers", hi: "स्थानांतरण" },
  "nav.imports": { en: "Register Importer", hi: "रजिस्टर आयात" },
  "nav.institutions": { en: "Institution 360", hi: "संस्थान 360" },
  "nav.reports": { en: "Reports & Analytics", hi: "रिपोर्ट और विश्लेषण" },
  "nav.cockpit": { en: "Management Cockpit", hi: "प्रबंधन कॉकपिट" },
  "nav.benchmark": { en: "Matching Benchmark", hi: "मिलान बेंचमार्क" },
  "nav.notifications": { en: "Notifications", hi: "सूचनाएं" },
  "nav.admin": { en: "Administration", hi: "प्रशासन" },
  "nav.audit": { en: "Audit Trail", hi: "लेखा परीक्षा" },
  "nav.settings": { en: "Profile & Settings", hi: "प्रोफ़ाइल और सेटिंग्स" },
  // common
  "action.newCase": { en: "New case", hi: "नया मामला" },
  "action.signOut": { en: "Sign out", hi: "साइन आउट" },
  "action.search": { en: "Search", hi: "खोजें" },
  "action.reset": { en: "Reset", hi: "रीसेट" },
  "action.apply": { en: "Apply filters", hi: "फ़िल्टर लागू करें" },
  "action.retry": { en: "Retry", hi: "पुनः प्रयास" },
  "action.cancel": { en: "Cancel", hi: "रद्द करें" },
  "action.markAllRead": { en: "Mark all read", hi: "सभी पढ़ा हुआ चिह्नित करें" },
  "search.placeholder": { en: "Search cases, institutions, pages…", hi: "मामले, संस्थान, पृष्ठ खोजें…" },
  "label.updated": { en: "Updated", hi: "अद्यतन" },
  "label.language": { en: "Language", hi: "भाषा" },
  "label.profile": { en: "Profile", hi: "प्रोफ़ाइल" },
  "label.syntheticData": { en: "Synthetic demo data", hi: "कृत्रिम डेमो डेटा" },
  "label.collapse": { en: "Collapse sidebar", hi: "साइडबार छोटा करें" },
  "label.expand": { en: "Expand sidebar", hi: "साइडबार बड़ा करें" },
} satisfies Record<string, { en: string; hi: string }>;

export type StringKey = keyof typeof STRINGS;

export function translate(key: string, lang: Lang): string {
  const entry = (STRINGS as Record<string, { en: string; hi: string }>)[key];
  return entry ? entry[lang] || entry.en : key;
}
