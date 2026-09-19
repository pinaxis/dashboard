import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SALT_FILE = ".anon-salt";

/**
 * @remarks repository names are enumerable, so an unsalted hash is reversible by brute force. An empty
 * salt would publish reversible pseudonyms while appearing to work, so absence is a hard failure.
 */
export function loadSalt({ env = process.env, root }) {
  const fromEnv = (env.PINAXIS_ANON_SALT ?? "").trim();
  if (fromEnv !== "") {
    return fromEnv;
  }
  let fromFile = "";
  try {
    fromFile = readFileSync(join(root, SALT_FILE), "utf8").trim();
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (fromFile !== "") {
    return fromFile;
  }
  throw new Error(
    `no anonymization salt: set PINAXIS_ANON_SALT or create ${SALT_FILE} in ${root}`);
}

/**
 * @remarks the visible label is a hash PREFIX rather than a sequential index, because an index assigned
 * in hash order shifts for every node after an insertion, which would re-draw pseudonyms the dataset is
 * supposed to keep stable.
 */
export function createPseudonymizer(salt, schemaVersion) {
  const keyed = `${salt}:v${schemaVersion}`;
  return (prefix, key) =>
    `${prefix}-${createHmac("sha256", keyed).update(key).digest("hex").slice(0, 8)}`;
}
