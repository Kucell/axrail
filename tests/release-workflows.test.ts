import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const CHECKOUT = "actions/checkout@11d5960a326750d5838078e36cf38b85af677262";
const SETUP_NODE = "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020";
const UPLOAD = "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";
const DOWNLOAD = "actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093";

async function workflow(name: string): Promise<string> {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

test("bootstrap release is protected, provenance-enabled and token-scoped", async () => {
  const source = await workflow("release-bootstrap.yml");
  assert.match(source, /environment: npm-release-bootstrap/);
  assert.match(source, /id-token: write/);
  assert.match(source, /secrets\.NPM_TOKEN/);
  assert.match(source, /npm publish .*--access public --tag rc --provenance/);
  assert.match(source, new RegExp(CHECKOUT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, new RegExp(UPLOAD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, new RegExp(DOWNLOAD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("trusted release stages through OIDC without a long-lived npm token", async () => {
  const source = await workflow("release-stage.yml");
  assert.match(source, /environment: npm-release/);
  assert.match(source, /id-token: write/);
  assert.match(source, /npm stage publish .*--access public --tag "\$DIST_TAG" --provenance/);
  assert.doesNotMatch(source, /NPM_TOKEN/);
  assert.match(source, new RegExp(CHECKOUT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, new RegExp(SETUP_NODE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("GitHub release finalizer verifies registry state before tag creation", async () => {
  const source = await workflow("release-finalize.yml");
  assert.match(source, /environment: github-release/);
  assert.match(source, /contents: write/);
  assert.match(source, /npm view "@axrail\/\$\{package\}@\$\{VERSION\}" version/);
  assert.match(source, /git tag -a "v\$\{VERSION\}"/);
  assert.match(source, /gh release create "v\$\{VERSION\}"/);
  assert.ok(
    source.indexOf("npm view") < source.indexOf("git tag -a"),
    "registry verification must happen before tag creation",
  );
  assert.match(source, new RegExp(CHECKOUT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
