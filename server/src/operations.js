export const OPERATIONS = [
  {
    id: "find_tags",
    summary: "Search the Qloo tag ontology by concept.",
    example: { query: "sneakers", limit: 5 },
  },
  {
    id: "describe",
    summary: "Describe one named entity.",
    example: { entity: "Nike", type: "brand" },
  },
  {
    id: "recommend",
    summary: "Recommend entities from taste signals.",
    example: {
      target_type: "movie",
      signals: ["Inception"],
      limit: 5,
    },
  },
  {
    id: "rank",
    summary: "Rank a fixed list of options against a taste profile.",
    example: {
      options: ["Nike", "Adidas"],
      option_type: "brand",
      signals: ["running"],
    },
  },
  {
    id: "where_popular",
    summary: "Find where an entity is popular.",
    example: { entity: "ramen", within: "United States", limit: 5 },
  },
  {
    id: "compare_audiences",
    summary: "Compare two audience groups.",
    example: {
      group_a: ["Nike"],
      group_b: ["Adidas"],
      target_type: "brand",
      limit: 5,
    },
  },
  {
    id: "entity_tags",
    summary: "Look up tags associated with entities.",
    example: { entities: ["Nike"], entity_type: "brand", limit: 5 },
  },
  {
    id: "audience_demographics",
    summary: "Aggregate demographics for an entity.",
    example: { entity: "Nike", entity_type: "brand" },
  },
  {
    id: "trends",
    summary: "Interest over an explicit date range.",
    example: {
      entities: ["Nike"],
      entity_type: "brand",
      start_date: "2024-01-01",
      end_date: "2024-06-01",
      limit: 5,
    },
  },
];

export const OPERATION_IDS = new Set(OPERATIONS.map((operation) => operation.id));

const SECRET_KEY = /^(api[-_]?key|qloo_api_key|authorization|access[-_]?token|secret|password|token)$/i;

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

export function containsSecretField(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 8) return false;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return true;
    if (containsSecretField(child, depth + 1)) return true;
  }
  return false;
}
