// 🌲 Real per-species CO₂ sequestration data + the emission math. The forest's
// "virtual CO₂ savings" sum these up — virtual, because the trees are characters.

// Researched by an agent fleet via web search (kg/year sequestered per mature tree).
export const SPECIES_CO2 = {
  oak: 22, pine: 20, maple: 22, birch: 22, willow: 22, spruce: 19.4, redwood: 312,
  baobab: 80, cactus: 15, bonsai: 1, "cherry blossom": 9.1, palm: 2.3,
  "giant sequoia": 305, "dawn redwood": 120, "coast douglas fir": 85, ginkgo: 18,
  kapok: 140, banyan: 95, jacaranda: 16, "monkey puzzle": 24, "joshua tree": 4,
  "bristlecone pine": 6, "weeping willow": 21, "japanese maple": 7, "flame tree": 28,
  mangrove: 12, acacia: 17, teak: 30, mahogany: 27, ebony: 13, "cork oak": 24,
  "dragon blood tree": 6, "rainbow eucalyptus": 45, "coconut palm": 3, fig: 14,
  olive: 8, cypress: 18, magnolia: 13, "tulip tree": 35, paulownia: 50, neem: 15,
  sandalwood: 7, frankincense: 4, "quiver tree": 3, "bottle tree": 10,
  "silk floss tree": 22, eucalyptus: 40, poplar: 38, beech: 21, ash: 20, elm: 21,
  sycamore: 25, cedar: 19, larch: 18, hemlock: 17, chestnut: 24, walnut: 23,
  hickory: 22, hawthorn: 6, rowan: 7, alder: 18, hornbeam: 16, sweetgum: 24,
  "black locust": 30, catalpa: 22, "horse chestnut": 21, "plane tree": 26,
  juniper: 5, yew: 6, holly: 4, "date palm": 4, "traveller's palm": 5, breadfruit: 20,
  durian: 18, mango: 17, avocado: 15, cacao: 9, coffee: 5, "rubber tree": 25,
  "brazil nut": 110, ceiba: 130, "strangler fig": 60, flamboyant: 27,
  "flame of the forest": 14, frangipani: 6, "camphor tree": 28, cinnamon: 8,
  clove: 7, nutmeg: 9, tamarind: 20, baldcypress: 30, kauri: 150, "wollemi pine": 14,
  "norfolk island pine": 16, tamarisk: 6, manchineel: 12, pomegranate: 5, loquat: 7,
  persimmon: 12, mulberry: 16, linden: 21, "gum arabic": 11, "baobab grandidier": 90,
};

export const DEFAULT_CO2 = 21;            // a generic mature tree, for species not in the table
export const co2For = (species) => SPECIES_CO2[String(species || "").toLowerCase()] ?? DEFAULT_CO2;

// The species the fleet plants — every name in the table, cycled for variety.
export const SPECIES = Object.keys(SPECIES_CO2);
export const speciesFor = (index) => SPECIES[index % SPECIES.length];

// Real CO₂ emitted by burning the tokens (rough flavour figure, not a precise LCA).
const CO2_KG_PER_1K_TOKENS = 0.0042;
export const emittedKg = (tokens) => (tokens / 1000) * CO2_KG_PER_1K_TOKENS;
