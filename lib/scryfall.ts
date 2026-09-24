type ListingIdentity = {
  title: string;
  card_name?: string | null;
  card_number?: string | null;
  set_name?: string | null;
};

export type ScryfallCandidate = {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  image_url: string | null;
};

const clean = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

function titleIdentity(row: ListingIdentity) {
  const slashNumber = row.title.match(/\b([A-Z]?\d{1,4}[a-z]?)\s*\/\s*\d{1,4}\b/i);
  const number = String(row.card_number || slashNumber?.[1] || "").trim();
  let name = String(row.card_name || "").trim();
  if (!name && slashNumber?.index != null) name = row.title.slice(0, slashNumber.index).trim();
  if (!name) {
    name = row.title
      .replace(/\b(Magic: The Gathering|Magic The Gathering|MTG|TCG|English|Japanese|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|NM|LP|MP|HP|DMG|Non[- ]?Foil|Foil|Etched Foil)\b/gi, " ")
      .replace(/\s+/g, " ").trim();
  }
  return { name, number };
}

export async function findScryfallCandidates(row: ListingIdentity): Promise<ScryfallCandidate[]> {
  const { name, number } = titleIdentity(row);
  if (!name || name.length < 2) return [];
  const terms = [`!\"${name.replace(/\"/g, "")}\"`, number ? `number:${number}` : ""].filter(Boolean).join(" ");
  const response = await fetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(terms)}&unique=prints`, {
    cache: "no-store", headers: { "User-Agent": "SwivelsInventory/1.10.7", Accept: "application/json" },
  });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Scryfall lookup failed (${response.status})`);
  const body: any = await response.json();
  const title = clean(row.title);
  const setHint = clean(String(row.set_name || ""));
  const cards = (body.data || []).map((card: any) => ({
    id: String(card.id), name: String(card.name), set: String(card.set), set_name: String(card.set_name),
    collector_number: String(card.collector_number),
    image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
  })) as ScryfallCandidate[];
  return cards.sort((a, b) => {
    const score = (candidate: ScryfallCandidate) => {
      const setName = clean(candidate.set_name);
      return (setHint && setName === setHint ? 4 : 0) + (setName && title.includes(setName) ? 3 : 0) + (number && clean(candidate.collector_number) === clean(number) ? 2 : 0);
    };
    return score(b) - score(a);
  }).slice(0, 8);
}

export function manaPoolVariant(row: { title:string; language?:string|null; finish?:string|null; condition_name?:string|null }) {
  const title = row.title.toLowerCase();
  const condition = String(row.condition_name || "").toLowerCase();
  const language = String(row.language || "").toLowerCase();
  const finish = String(row.finish || "").toLowerCase();
  const condition_id = /damaged|\bdmg\b/.test(condition + " " + title) ? "DMG" : /heavy|\bhp\b/.test(condition + " " + title) ? "HP" : /moderate|\bmp\b/.test(condition + " " + title) ? "MP" : /light|\blp\b/.test(condition + " " + title) ? "LP" : "NM";
  const language_id = /japanese|\bjp\b/.test(language + " " + title) ? "JA" : "EN";
  const finish_id = /etched/.test(finish + " " + title) ? "EF" : /foil/.test(finish + " " + title) && !/non[- ]?foil/.test(finish + " " + title) ? "FO" : "NF";
  return { condition_id, language_id, finish_id };
}
