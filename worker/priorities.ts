const NAME = /^[a-z0-9-]+$/;

export function parseWeights(raw: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || !raw.trim()) {
    return out;
  }
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) {
      continue;
    }
    const colon = trimmed.lastIndexOf(":");
    const name = trimmed.slice(0, colon).trim();
    const weight = Number(trimmed.slice(colon + 1).trim());
    if (colon > 0 && Number.isInteger(weight)) {
      out[name] = weight;
    }
  }
  return out;
}

export function formatWeights(weights: Record<string, number>): string {
  return Object.entries(weights).map(([name, weight]) => `${name}:${weight}`).join(",");
}

export function validateWeights(body: unknown): Record<string, number> | string {
  if (typeof body !== "object" || body === null || !("weights" in body)) {
    return "the body must be an object with a weights field";
  }
  const weights = (body as { weights: unknown }).weights;
  if (typeof weights !== "object" || weights === null || Array.isArray(weights)) {
    return "weights must be an object of name to number";
  }
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(weights as Record<string, unknown>)) {
    if (!NAME.test(name)) {
      return `not a target name: ${name}`;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
      return `weight for ${name} must be an integer from 1 to 100`;
    }
    out[name] = value;
  }
  return out;
}
