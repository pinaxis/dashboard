const CONFIG_FILENAMES = new Set([".env", ".npmrc", ".netrc", ".pypirc", ".dockercfg", ".htpasswd",
  ".pgpass", ".replit"]);
const EXTENSION_SHAPE = /^\.[a-z0-9][a-z0-9.+-]{0,15}$/;
const OTHER_EXTENSION = "(other)";

/**
 * @remarks the input is a path from a stranger's repository, so nothing may pass through unchecked: a
 * directory name, a datestamped suffix or a name like ".aws-credentials-jdoe" would publish third-party
 * structure. A leading-dot file has no extension to strip and its whole name is the signal worth
 * reporting, so the allowlist admits ".env" and its peers whole; everything else must look like an
 * ordinary short extension or it collapses to "(other)".
 */
export function extensionOf(path) {
  const base = path.split(/[\\/]/).pop().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot < 0) {
    return "(no extension)";
  }
  if (dot === 0) {
    return CONFIG_FILENAMES.has(base) ? base : OTHER_EXTENSION;
  }
  const extension = base.slice(dot);
  return EXTENSION_SHAPE.test(extension) ? extension : OTHER_EXTENSION;
}
