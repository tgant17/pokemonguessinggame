// Each pull request's Vercel preview plays online rooms on its own copy of the room server, so changes to
// party/room.ts or the rules it runs can be tried before they reach the live site. The copy is a separate
// Cloudflare Worker named after the branch: .github/workflows/preview-rooms.yml deploys it (and deletes it
// when the pull request closes), and next.config.ts points the preview build at it. Both get the name from
// here so they always agree. Keep this free of imports: Node runs it directly in the workflow.

// The live room server's Worker name (wrangler.jsonc). Preview copies add the branch after it.
const LIVE_WORKER = "pokemonguessinggame-rooms";
// A Worker's name is the first label of its workers.dev address, and DNS labels stop at 63 characters.
const MAX_NAME_LENGTH = 63;
const MAX_BRANCH_PART = MAX_NAME_LENGTH - LIVE_WORKER.length - 1;
const HASH_LENGTH = 7;

// FNV-1a: a short, stable fingerprint so long branch names that share a prefix still get different Workers.
const fingerprint = (text: string) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(HASH_LENGTH, "0");
};

// "feature/winner-takes-all" -> "pokemonguessinggame-rooms-feature-winner-takes-all". Names that wouldn't
// fit are cut short and end in a fingerprint of the full branch name.
export function previewWorkerName(branch: string): string {
  const slug = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug && slug.length <= MAX_BRANCH_PART) return `${LIVE_WORKER}-${slug}`;
  const start = slug.slice(0, MAX_BRANCH_PART - HASH_LENGTH - 1).replace(/-+$/, "");
  return [LIVE_WORKER, start, fingerprint(branch)].filter(Boolean).join("-");
}
