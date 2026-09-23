export type CardIdentity = {
  title?: string | null; game?: string | null; setName?: string | null;
  cardName?: string | null; cardNumber?: string | null; finish?: string | null;
  language?: string | null; condition?: string | null; parallel?: string | null;
};

const clean = (value?: string | null) => String(value || "").toLowerCase()
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const titleCardName = (title?: string | null) => clean(title)
  .replace(/\b(pokemon|pokémon|tcg|near mint|nm|lightly played|lp|english|card)\b/g, " ")
  .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, " ").replace(/\s+/g, " ").trim();

const conditionKey = (value?: string | null) => {
  const v = clean(value).replace(/^ungraded\s+/, "").replace(/\bid\s+\d+\b/g, "").trim();
  if (/^(near mint|near mint or better|nm)$/.test(v)) return "near mint";
  if (/^(light play|lightly played|lp)$/.test(v)) return "light play";
  if (/^(moderate play|moderately played|mod play|mp)$/.test(v)) return "moderate play";
  if (/^(heavy play|heavily played|hp)$/.test(v)) return "heavy play";
  if (/^(damaged|damage|dmg)$/.test(v)) return "damaged";
  return v;
};

export function cardMatchKey(card: CardIdentity) {
  const game = clean(card.game).replace("pokemon tcg", "pokemon");
  const setName = clean(card.setName);
  const cardName = clean(card.cardName) || titleCardName(card.title);
  const cardNumber = clean(card.cardNumber);
  const finish = clean(card.finish) || "standard";
  const language = clean(card.language) || "english";
  const condition = conditionKey(card.condition);
  const parallel = clean(card.parallel);
  // Condition is part of identity: NM, LP, MP, HP and DMG are separate listings.
  // Refuse to classify a listing when it is missing instead of guessing.
  if (!setName || !cardName || !cardNumber || !condition) return "";
  return [game, setName, cardName, cardNumber, finish, language, condition, parallel].join("|");
}

export function csvIdentity(row: Record<string, string>): CardIdentity {
  return {
    title: row["*Title"], game: row["*C:Game"], setName: row["*C:Set"],
    cardName: row["*C:Card Name"], cardNumber: row["*C:Card Number"],
    finish: row["*C:Finish"], language: row["*C:Language"],
    condition: row["C:Card Condition"] || row["CD:Card Condition - (ID: 40001)"],
    parallel: row["C:Parallel/Variety"],
  };
}
