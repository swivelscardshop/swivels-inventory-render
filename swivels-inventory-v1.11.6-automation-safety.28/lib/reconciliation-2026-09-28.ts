// User-provided eBay ended-listing export for the September 28 combine incident.
export const incidentEndedListings = [
  ["147578788666","Box-B-33-050","Eowyn, Lady of Rohan 10 The Lord of the Rings MTG NM","2026-09-28T18:06:16.000Z"],
  ["147597694731","Box-B-35-003","Rally at the Hornburg 142 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:22.000Z"],
  ["147597694734","Box-B-35-012","Mirkwood Spider 178 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T17:31:16.000Z"],
  ["147597694737","Box-B-35-018","Meriadoc Brandybuck 177 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:15.000Z"],
  ["147597694739","Box-B-35-006","Gandalf's Sanction 208 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:39.000Z"],
  ["147597694740","Box-B-35-027","The Torment of Gollum 110 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:16.000Z"],
  ["147597694748","Box-B-35-030","Mountain (0269) 269 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:28.000Z"],
  ["147597694749","Box-B-35-028","Soothing of Smeagol 70 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:23.000Z"],
  ["147597694751","Box-B-35-037","Landroval, Horizon Witness 21 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:39:28.000Z"],
  ["147597694754","Box-B-35-039","Shire Shirriff 30 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:37:05.000Z"],
  ["147597694761","Box-B-35-011","Oliphaunt 139 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:37:12.000Z"],
  ["147597694762","Box-B-35-021","Orc Army Token (0006) 6 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:37:13.000Z"],
  ["147597694767","Box-B-35-005","Gollum's Bite 85 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:31.000Z"],
  ["147597694777","Box-B-35-038","Meneldor, Swift Savior 62 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:37.000Z"],
  ["147597694784","Box-B-35-007","Council's Deliberation 46 The Lord of the Rings Magic: The Gathering TCG NM","2026-09-28T18:06:46.000Z"],
].map(([ebay_listing_id,ebay_sku,title,ended_at])=>({ebay_listing_id,ebay_sku,title,ended_at,condition_name:"Near mint or better",quantity_sold:0}));
