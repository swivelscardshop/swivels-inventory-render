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

export function titleIdentity(row: ListingIdentity) {
  const title = String(row.title || "").replace(/\s+/g, " ").trim();
  const gameMarker = title.search(/\s+(?:Magic\s*:\s*The Gathering|Magic The Gathering|MTG)\b/i);
  const identitySection = (gameMarker >= 0 ? title.slice(0, gameMarker) : title).trim();
  const finishMatch = identitySection.match(/\s+(Etched Foil|Non[- ]?Foil|Foil)\s*$/i);
  const beforeFinish = (finishMatch ? identitySection.slice(0, finishMatch.index) : identitySection).trim();
  const slashNumber = beforeFinish.match(/\b([A-Z]?\d{1,4}[a-z]?)\s*\/\s*\d{1,4}\b/i);
  // Magic titles use a plain collector number between the card name and set
  // name. eBay item specifics are preferred when present; otherwise locate
  // that positional number in the title.
  const plainNumbers = [...beforeFinish.matchAll(/(?:^|\s)([A-Z]?\d{1,4}[a-z]?)(?=\s|$)/gi)];
  const positional = slashNumber || plainNumbers.find((match) => {
    const start = match.index == null ? -1 : match.index + match[0].length - match[1].length;
    return start > 1 && beforeFinish.slice(start + match[1].length).trim().length > 1;
  });
  const number = String(row.card_number || positional?.[1] || "").split("/")[0].trim();
  const numberIndex = positional?.index == null ? -1 : positional.index + positional[0].length - positional[1].length;
  let name = String(row.card_name || "").trim();
  if (!name && numberIndex >= 0) name = beforeFinish.slice(0, numberIndex).trim();
  if (!name) {
    name = title
      .replace(/\b(Magic: The Gathering|Magic The Gathering|MTG|TCG|English|Japanese|Near Mint|Lightly Played|Moderately Played|Heavily Played|Damaged|NM|LP|MP|HP|DMG|Non[- ]?Foil|Foil|Etched Foil)\b/gi, " ")
      .replace(/\s+/g, " ").trim();
  }
  const inferredSet = numberIndex >= 0
    ? beforeFinish.slice(numberIndex + String(positional?.[1] || "").length).trim()
    : "";
  return {
    name,
    number,
    setName: String(row.set_name || inferredSet || "").trim(),
    finish: finishMatch && !/^non/i.test(finishMatch[1]) ? finishMatch[1] : "Non-Foil",
  };
}

export async function findScryfallCandidates(row: ListingIdentity): Promise<ScryfallCandidate[]> {
  const { name, number, setName } = titleIdentity(row);
  if (!name || name.length < 2) return [];
  const terms = [`!\"${name.replace(/\"/g, "")}\"`, number ? `number:${number}` : ""].filter(Boolean).join(" ");
  const headers = { "User-Agent": "SwivelsInventory/1.10.8", Accept: "application/json" };
  const get = async (url: string, retry = true): Promise<any> => {
    const response = await fetch(url, { cache:"no-store", headers });
    if (response.status === 429 && retry) {
      await new Promise(resolve => setTimeout(resolve, 500));
      return get(url, false);
    }
    if (!response.ok) return null;
    return response.json();
  };
  let body: any = await get(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(terms)}&unique=prints`);
  // Titles sometimes contain punctuation that Scryfall's exact-search parser
  // rejects. Resolve the card name fuzzily, then load all of its printings.
  if (!body?.data?.length) {
    const named = await get(`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name.slice(0, 180))}`);
    if (!named) return [];
    body = named.prints_search_uri ? await get(String(named.prints_search_uri)) : { data:[named] };
  }
  const title = clean(row.title);
  const setHint = clean(setName);
  let sourceCards = body?.data || [];
  if (number) sourceCards = sourceCards.filter((card:any) => clean(String(card.collector_number || "")) === clean(number));
  const cards = sourceCards.map((card: any) => ({
    id: String(card.id), name: String(card.name), set: String(card.set), set_name: String(card.set_name),
    collector_number: String(card.collector_number),
    image_url: card.image_uris?.normal || card.card_faces?.[0]?.image_uris?.normal || null,
  })) as ScryfallCandidate[];
  return cards.sort((a, b) => {
    const score = (candidate: ScryfallCandidate) => {
      const setName = clean(candidate.set_name);
      const setAlias = clean(candidate.set_name.split(":")[0]);
      const hintMatches = setHint && (setName === setHint || setAlias === setHint || setName.includes(setHint) || setHint.includes(setAlias));
      return (hintMatches ? 6 : 0) + (setName && title.includes(setName) ? 3 : 0) + (number && clean(candidate.collector_number) === clean(number) ? 2 : 0);
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
