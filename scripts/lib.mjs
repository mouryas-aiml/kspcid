import { createHash, createHmac } from "node:crypto";
import { createReadStream } from "node:fs";

export const ROOT = new URL("../", import.meta.url).pathname.replace(/\/scripts\/$/, "");
export const SOURCE_FILE = `${ROOT}/Crime_Data_from_2020_to_2024_20260724.csv`;
export const GENERATION_VERSION = "blr-synthetic-v1.0.0";
export const GENERATION_SEED = "KPSCID-BENGALURU-SYNTHETIC-CRIME-2020-2024-V1";
export const UUID_NAMESPACE = "7f1c478f-1813-5b84-a6f6-2a38edc04832";

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableUint64(stage, stableKey, namespace = "") {
  const digest = createHmac("sha256", GENERATION_SEED)
    .update(`${GENERATION_VERSION}|${stage}|${stableKey}|${namespace}`)
    .digest();
  return digest.readBigUInt64BE(0);
}

export function stableIndex(stage, stableKey, namespace, length) {
  if (!Number.isInteger(length) || length < 1) throw new Error(`Invalid candidate length: ${length}`);
  return Number(stableUint64(stage, stableKey, namespace) % BigInt(length));
}

export function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(police|station|ps|traffic)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export function csvEscape(value) {
  const string = value == null ? "" : String(value);
  return /[",\r\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
}

export function percentile(sortedValues, probability) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const fraction = index - lower;
  return sortedValues[lower] * (1 - fraction) + sortedValues[upper] * fraction;
}

export function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: sorted[0] ?? 0,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.at(-1) ?? 0,
  };
}

export function parseSourceDate(value) {
  const match = String(value).match(/^(\d{4})\s+([A-Z][a-z]{2})\s+(\d{2})/);
  if (!match) throw new Error(`Unparseable source date: ${value}`);
  const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
  return `${match[1]}-${months[match[2]]}-${match[3]}`;
}

export function occurrenceTimestamp(dateValue, timeValue) {
  const date = parseSourceDate(dateValue);
  const padded = String(timeValue ?? "").padStart(4, "0");
  const hour = Math.min(23, Number(padded.slice(0, 2)) || 0);
  const minute = Math.min(59, Number(padded.slice(2, 4)) || 0);
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`;
}

export function cleanLabel(value) {
  return String(value ?? "")
    .replace(/\$\s*[\d,.]+(?:\s*&?\s*(?:OVER|UNDER))?/gi, "")
    .replace(/\b(?:FELONY|MISDEMEANOR|GRAND|PETTY)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,;:)])/g, "$1")
    .replace(/[(]\s*[)]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function classifyCrime(description) {
  const d = String(description).toUpperCase();
  const rules = [
    [/\b(HOMICIDE|MANSLAUGHTER)\b/, "violent_crime", "homicide"],
    [/\bHUMAN TRAFFICKING\b/, "violent_crime", "human_trafficking"],
    [/\b(CHILD NEGLECT|CHILD ABUSE|CHILD PORNOGRAPHY|CHILD ABANDONMENT|CHILD STEALING|CHILD ANNOYING|CRM AGNST CHLD|CONTRIBUTING)\b/, "family_child_offence", "child_related_offence"],
    [/\b(INTIMATE PARTNER|DOMESTIC)\b/, "family_child_offence", "domestic_violence"],
    [/\b(RAPE|SEX|SEXUAL|SODOMY|LEWD|INDECENT|ORAL COPULATION|PENETRATION)\b/, "sexual_offence", "sexual_offence"],
    [/\b(PIMPING|PANDERING)\b/, "sexual_offence", "sexual_exploitation"],
    [/\b(KIDNAPP|ABDUCTION)/, "violent_crime", "kidnapping"],
    [/\bFALSE IMPRISONMENT\b/, "violent_crime", "unlawful_confinement"],
    [/\bROBBERY\b/, "violent_crime", "robbery"],
    [/\bASSAULT|BATTERY|SHOTS FIRED|DISCHARGE FIREARM|LYNCHING|THROWING OBJECT\b/, "violent_crime", "assault"],
    [/\bARSON\b/, "property_crime", "arson"],
    [/\bBURGLARY\b/, "property_crime", d.includes("VEHICLE") ? "theft_from_vehicle" : "burglary"],
    [/\bVEHICLE-RELATED\b/, "property_crime", "vehicle_related_offence"],
    [/\bVEHICLE\b.*\bSTOLEN\b|\bSTOLEN VEHICLE\b/, "property_crime", "vehicle_theft"],
    [/\bIDENTITY|FRAUD|FORGERY|COUNTERFEIT|EMBEZZLEMENT|CREDIT CARD|EXTORTION|BUNCO|DOCUMENT WORTHLESS|DEFRAUDING\b/, "fraud_cyber_crime", "fraud"],
    [/\bCYBER|COMPUTER|ELECTRONIC\b/, "fraud_cyber_crime", "cybercrime"],
    [/\bTHEFT FROM MOTOR VEHICLE\b/, "property_crime", "theft_from_vehicle"],
    [/\bSHOPLIFT/, "property_crime", "shoplifting"],
    [/\bTHEFT|STOLEN|PICKPOCKET|PURSE SNATCH|BIKE|DRUNK ROLL|TILL TAP\b/, "property_crime", "theft"],
    [/\bVANDALISM|DAMAGE|TRAIN WRECK\b/, "property_crime", "property_damage"],
    [/\bWEAPON|FIREARM|BOMB|EXPLOSIVE\b/, "weapons_offence", "weapons_offence"],
    [/\bDRUG|NARCOTIC\b/, "drug_offence", "drug_offence"],
    [/\bTRESPASS/, "public_order", "trespass"],
    [/\bTHREAT|STALK|HARASS\b/, "public_order", "threat_or_harassment"],
    [/\bRESTRAINING ORDER|COURT ORDER|CONTEMPT|PROTECTIVE ORDER|REGISTRANT OUT OF COMPLIANCE\b/, "public_order", "order_violation"],
    [/\b(RECKLESS DRIVING|FAILURE TO YIELD|DRIVING WITHOUT OWNER CONSENT)\b/, "public_order", "traffic_offence"],
    [/\b(RESISTING ARREST|FALSE POLICE REPORT|BRIBERY|CONSPIRACY)\b/, "public_order", "justice_or_corruption_offence"],
    [/\b(RIOT|FAILURE TO DISPERSE|DISTURBING THE PEACE|DISRUPT SCHOOL|BLOCKING DOOR)\b/, "public_order", "public_disorder"],
    [/\b(PEEPING TOM|PROWLER|LETTERS, LEWD)\b/, "public_order", "privacy_or_harassment_offence"],
    [/\bILLEGAL DUMPING\b/, "public_order", "illegal_dumping"],
    [/\bCRUELTY TO ANIMALS|BEASTIALITY\b/, "other_incident", "animal_related_offence"],
    [/\bBIGAMY|INCEST\b/, "family_child_offence", "family_related_offence"],
    [/\bMISSING\b/, "other_incident", "missing_person"],
  ];
  for (const [pattern, category, subcategory] of rules) {
    if (pattern.test(d)) return { category, subcategory };
  }
  return { category: "other_incident", subcategory: cleanLabel(description) || "other" };
}

export function classifyPremise(description) {
  const d = String(description ?? "").toUpperCase();
  if (!d) return { category: "unknown", broad: "built_other" };
  if (/\b(BUS|METRO|TRAIN|RAIL|AIRPORT|TRANSPORT|STATION|TERMINAL)\b/.test(d))
    return { category: "transit", broad: "transit" };
  if (/\b(SINGLE FAMILY|MULTI-UNIT|APARTMENT|DWELLING|RESIDENCE|CONDOMINIUM|PORCH|YARD|GARAGE|CARPORT|HOTEL|MOTEL)\b/.test(d))
    return { category: "residential", broad: "residential" };
  if (/\b(SCHOOL|COLLEGE|UNIVERSITY|HOSPITAL|CLINIC|CHURCH|TEMPLE|MOSQUE|GOVERNMENT|PARK|LIBRARY|COURT|POLICE|FIRE STATION)\b/.test(d))
    return { category: "public_institutional", broad: "public_institutional" };
  if (/\b(STREET|SIDEWALK|ALLEY|DRIVEWAY|PARKING|BEACH|OPEN AREA|UNDERPASS|BRIDGE)\b/.test(d))
    return { category: "outdoor", broad: "outdoor" };
  if (/\b(VEHICLE|TAXI|TRUCK|AUTOMOBILE)\b/.test(d))
    return { category: "vehicle", broad: "outdoor" };
  if (/\b(STORE|SHOP|MARKET|BUSINESS|RESTAURANT|BAR|CAFE|BANK|OFFICE|MALL|THEATRE|WAREHOUSE|FACTORY|PHARMACY|GAS STATION)\b/.test(d))
    return { category: "commercial", broad: "commercial" };
  return { category: "built_other", broad: "built_other" };
}

export function classifyWeapon(description) {
  const d = String(description ?? "").toUpperCase();
  if (!d) return "";
  if (/\b(GUN|RIFLE|SHOTGUN|REVOLVER|PISTOL|FIREARM)\b/.test(d)) return "firearm";
  if (/\b(KNIFE|BLADE|MACHETE|SWORD|SCISSORS|RAZOR)\b/.test(d)) return "sharp_object";
  if (/\b(CLUB|BAT|STICK|ROD|HAMMER|BLUNT|BRASS KNUCKLES)\b/.test(d)) return "blunt_object";
  if (/\b(VEHICLE)\b/.test(d)) return "vehicle";
  if (/\b(BOMB|EXPLOSIVE)\b/.test(d)) return "explosive";
  if (/\b(CHEMICAL|POISON|GAS|FIRE|BURN)\b/.test(d)) return "chemical_or_fire";
  if (/\b(HANDS|FIST|FEET|BODILY FORCE)\b/.test(d)) return "physical_force";
  return "other_weapon";
}

export function classifyStatus(code) {
  return {
    IC: "under_investigation",
    AA: "arrest_made",
    JA: "arrest_made",
    AO: "closed_other",
    JO: "closed_other",
    CC: "unknown",
    "": "unknown",
  }[String(code ?? "")];
}

export function classifyVictimSex(code) {
  return { M: "male", F: "female", X: "other_or_unknown", H: "other_or_unknown", "-": "other_or_unknown", "": "unknown" }[String(code ?? "")] ?? "other_or_unknown";
}
