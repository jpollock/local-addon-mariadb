# MariaDB Version Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer MariaDB 11.4.12, 11.8.8, 12.3.2, and 10.11.18 in Local's database dropdown, replacing 10.11.11 and keeping the EOL 10.6.23 working.

**Architecture:** `SUPPORTED_VERSIONS` in `src/constants.ts` already drives service-directory generation, binary download, and startup wiring — adding a version is a data change plus one trip through the build-and-release pipeline. The work is sequenced to de-risk: harden CI first, prove the path with a single version (11.8.8), then batch the remaining three.

**Tech Stack:** TypeScript, CommonJS, Jest, `fs-extra`, GitHub Actions, `gh` CLI

**Design spec:** `docs/specs/2026-08-05-mariadb-version-expansion-design.md`

## Global Constraints

- Target versions, exact: `10.11.18`, `11.4.12`, `11.8.8`, `12.3.2`. `10.6.23` stays. `10.11.11` is removed from the array **by the end of Task 4** — Task 3 deliberately leaves it in place so `tests/main.test.ts` keeps passing until Task 4 updates it. A Task 3 diff that still contains `10.11.11` is correct.
- `ServiceVersion` gains no new fields. EOL status is documented in the README only — never in `productName`, which would disturb Local's `isAddonLoaded` dedup.
- Never delete an existing `lightning-services/mariadb-*` directory. `main.ts` only creates and patches.
- Binaries keep their legacy `mysql*` invocation names. Switching to `mariadb-*` is out of scope.
- Releases are created as drafts and published only after a Local smoke test.
- Every release must end with exactly 6 assets: 3 `.tar.gz` + 3 `.sha256`.
- Run `npm run build` before `npm test` — several tests read from `lib/`.

---

### Task 1: Harden the CI smoke test

Today the workflow only runs `mysqld --version`, which cannot detect a MariaDB build whose bootstrap path is broken. That is the exact failure mode most likely on the 11.x/12.x jump. Replace it with a check that mirrors `bootstrapDatadir()`.

**Files:**
- Modify: `.github/workflows/build-mariadb.yml:162-165` (the `Smoke test — mysqld --version` step)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a workflow whose `build` job fails when bootstrap or startup fails. Tasks 3 and 4 rely on this gate.

- [ ] **Step 1: Read the current smoke test step**

```bash
grep -n "Smoke test" -A 4 .github/workflows/build-mariadb.yml
```

Expected: a step named `Smoke test — mysqld --version` that resolves `MYSQLD` and runs `$MYSQLD --version`.

- [ ] **Step 2: Replace the step**

Replace that entire step with the following. It mirrors `src/MariadbService.ts:106-154` — same `--no-defaults --bootstrap` invocation, same SQL including the `PASSWORD()` call — then starts the server and pings it.

```yaml
      - name: Smoke test — bootstrap datadir and start server
        run: |
          set -uo pipefail
          MYSQLD=$([ -f ./install/bin/mysqld ] && echo ./install/bin/mysqld || echo ./install/bin/mariadbd)
          "$MYSQLD" --version

          SMOKE="$PWD/smoke"
          mkdir -p "$SMOKE/data"

          # Mirrors bootstrapDatadir() in src/MariadbService.ts
          {
            echo 'CREATE DATABASE IF NOT EXISTS mysql;'
            echo 'USE mysql;'
            cat install/share/mysql_system_tables.sql
            echo 'USE mysql;'
            cat install/share/mysql_system_tables_data.sql
            echo "UPDATE mysql.global_priv SET priv=json_set(priv,'\$.plugin','mysql_native_password','\$.authentication_string',PASSWORD('root')) WHERE user='root' AND host='localhost';"
            echo 'FLUSH PRIVILEGES;'
          } > "$SMOKE/init.sql"

          if ! "$MYSQLD" --no-defaults --bootstrap \
                --datadir="$SMOKE/data" \
                --basedir="$PWD/install" \
                --socket="$SMOKE/bootstrap.sock" \
                < "$SMOKE/init.sql"; then
            echo "::error::bootstrap failed for ${{ inputs.mariadb_version }}"
            exit 1
          fi
          echo "bootstrap succeeded"

          "$MYSQLD" --no-defaults \
            --datadir="$SMOKE/data" \
            --basedir="$PWD/install" \
            --socket="$SMOKE/mysqld.sock" \
            --skip-networking &
          MYSQLD_PID=$!

          for i in $(seq 1 30); do
            if ./install/bin/mysqladmin --socket="$SMOKE/mysqld.sock" \
                 --user=root --password=root ping 2>/dev/null; then
              echo "server responded to ping"
              kill "$MYSQLD_PID" 2>/dev/null || true
              exit 0
            fi
            sleep 1
          done

          echo "::error::server did not respond within 30s"
          kill "$MYSQLD_PID" 2>/dev/null || true
          exit 1
```

Notes for the implementer:
- `set -e` is deliberately omitted. The bootstrap is checked explicitly with `if !` so the error message is useful, and on MariaDB 11.4+ the binaries write a "Deprecated program name" warning to stderr that must not abort the script.
- `\$.plugin` and `\$.authentication_string` are escaped because the surrounding shell string is double-quoted. They must reach MariaDB as literal `$.plugin` / `$.authentication_string`.
- `--skip-networking` is used instead of `--port` so parallel matrix legs cannot collide on a TCP port.

- [ ] **Step 3: Validate the YAML parses**

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-mariadb.yml')); print('YAML OK')"
```

Expected: `YAML OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build-mariadb.yml
git commit -m "ci: smoke test now bootstraps a datadir and starts the server"
```

---

### Task 2: Add a gated, idempotent, draft release job

The repository has no release automation — both existing releases were uploaded by hand, which is how v10.6.23 ended up with 4 of its 6 assets. This task adds the job and validates it by re-dispatching 10.6.23, which simultaneously backfills the missing checksums.

**Files:**
- Modify: `.github/workflows/build-mariadb.yml` (append a `release` job after the `build` job)

**Interfaces:**
- Consumes: the hardened `build` job from Task 1.
- Produces: a `release` job that publishes a draft release with 6 verified assets. Tasks 3 and 4 dispatch this workflow and expect a draft to appear.

- [ ] **Step 1: Append the release job**

Add at the end of `.github/workflows/build-mariadb.yml`, at the same indentation as the existing `build:` job (two spaces):

```yaml
  release:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    env:
      GH_TOKEN: ${{ github.token }}
      TAG: v${{ inputs.mariadb_version }}
    steps:
      - name: Download all platform artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts
          merge-multiple: true

      - name: Create draft release if absent
        run: |
          if gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then
            echo "Release $TAG already exists — uploading into it."
          else
            gh release create "$TAG" \
              --repo "$GITHUB_REPOSITORY" \
              --title "MariaDB ${{ inputs.mariadb_version }}" \
              --notes "Prebuilt MariaDB ${{ inputs.mariadb_version }} binaries for Local." \
              --draft
          fi

      - name: Upload assets
        run: gh release upload "$TAG" --repo "$GITHUB_REPOSITORY" --clobber artifacts/*

      - name: Verify asset count
        run: |
          COUNT=$(gh release view "$TAG" --repo "$GITHUB_REPOSITORY" --json assets -q '.assets | length')
          echo "Release $TAG has $COUNT assets."
          if [ "$COUNT" -ne 6 ]; then
            echo "::error::Expected 6 assets (3 tarballs + 3 checksums), found $COUNT"
            exit 1
          fi
```

Notes for the implementer:
- `needs: build` is the entire gate. `fail-fast: false` lets all three matrix legs finish, but the `build` job still concludes as failed if any leg fails, which skips `release`. Do not add further gating.
- The create-if-absent guard exists because `gh release create` errors on an existing tag, and v10.6.23 is already published.
- `--clobber` makes re-dispatch safe and overwrites stale assets.

- [ ] **Step 2: Validate the YAML parses and the job is registered**

```bash
python3 -c "
import yaml
w = yaml.safe_load(open('.github/workflows/build-mariadb.yml'))
assert 'release' in w['jobs'], 'release job missing'
assert w['jobs']['release']['needs'] == 'build', 'release must depend on build'
print('OK: jobs =', list(w['jobs']))
"
```

Expected: `OK: jobs = ['build', 'release']`

- [ ] **Step 3: Commit and push**

The workflow must be on `main` before `workflow_dispatch` can run it.

```bash
git add .github/workflows/build-mariadb.yml
git commit -m "ci: add gated idempotent draft release job"
git push
```

- [ ] **Step 4: Validate against 10.6.23 and backfill its missing checksums**

```bash
gh workflow run "Build MariaDB" -f mariadb_version=10.6.23
sleep 20
gh run list --workflow="Build MariaDB" --limit 1
```

Then watch it to completion (macOS builds take roughly 30-45 minutes):

```bash
gh run watch "$(gh run list --workflow='Build MariaDB' --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected: all three build legs succeed, then `release` succeeds with `Release v10.6.23 has 6 assets.`

- [ ] **Step 5: Confirm the backfill landed**

```bash
gh release view v10.6.23 --json assets -q '.assets[].name' | sort
```

Expected, all six:

```
bin-darwin-10.6.23.tar.gz
bin-darwin-10.6.23.tar.gz.sha256
bin-darwin-arm64-10.6.23.tar.gz
bin-darwin-arm64-10.6.23.tar.gz.sha256
bin-linux-10.6.23.tar.gz
bin-linux-10.6.23.tar.gz.sha256
```

If the run failed at the smoke test, Task 1's script has a bug — fix it before proceeding, since every later task depends on this gate.

---

### Task 3: Spike — build, release, and wire in 11.8.8

One version end-to-end to prove the 11.x path before committing nine more build jobs.

**Files:**
- Modify: `src/constants.ts:10-13`
- Modify: `tests/downloader.test.ts:82-86`

**Interfaces:**
- Consumes: the `release` job from Task 2.
- Produces: `SUPPORTED_VERSIONS` containing a `{ version: '11.8.8', bundled: false }` entry. Task 4 extends the same array.

- [ ] **Step 1: Write the failing test**

Add to `tests/downloader.test.ts`, immediately after the existing `uses the correct URL for 10.11.11` test:

```typescript
    it('uses the correct URL for 11.8.8', () => {
        const url = getBinaryUrl('darwin-arm64', '11.8.8');
        expect(url).toContain('/v11.8.8/');
        expect(url).toContain('bin-darwin-arm64-11.8.8.tar.gz');
    });
```

Add a new `describe` block at the end of `tests/downloader.test.ts`:

```typescript
describe('SUPPORTED_VERSIONS', () => {
    it('includes 11.8.8 as a non-bundled version', () => {
        const { SUPPORTED_VERSIONS } = require('../src/constants');
        const entry = SUPPORTED_VERSIONS.find((v: any) => v.version === '11.8.8');
        expect(entry).toBeDefined();
        expect(entry.bundled).toBe(false);
    });

    it('keeps 10.6.23 as the only bundled version', () => {
        const { SUPPORTED_VERSIONS } = require('../src/constants');
        const bundled = SUPPORTED_VERSIONS.filter((v: any) => v.bundled);
        expect(bundled).toHaveLength(1);
        expect(bundled[0].version).toBe('10.6.23');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run build && npx jest tests/downloader.test.ts -t "11.8.8" -v
```

Expected: FAIL — `includes 11.8.8 as a non-bundled version` reports `expect(received).toBeDefined()` because the entry does not exist yet. (`uses the correct URL for 11.8.8` will already pass — `getBinaryUrl` is version-agnostic.)

- [ ] **Step 3: Add the version**

In `src/constants.ts`, replace the `SUPPORTED_VERSIONS` array with:

```typescript
export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },  // EOL upstream 2026-07-06
    { version: '10.11.11', bundled: false },
    { version: '11.8.8',   bundled: false },
];
```

`10.11.11` stays for now — Task 4 replaces it with 10.11.18, and removing it here would break `tests/main.test.ts` before that task can fix it.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run build && npm test
```

Expected: all tests pass, including the two new `SUPPORTED_VERSIONS` tests.

- [ ] **Step 5: Commit and push**

```bash
git add src/constants.ts tests/downloader.test.ts
git commit -m "feat: add MariaDB 11.8.8"
git push
```

- [ ] **Step 6: Build and release the binaries**

```bash
gh workflow run "Build MariaDB" -f mariadb_version=11.8.8
sleep 20
gh run watch "$(gh run list --workflow='Build MariaDB' --limit 1 --json databaseId -q '.[0].databaseId')"
```

Expected: three build legs pass the new bootstrap smoke test, then `release` reports `Release v11.8.8 has 6 assets.`

If a build leg fails at the smoke test, capture the error before changing anything — that is the 11.x incompatibility this spike exists to find. Record it in the findings file in Step 9.

- [ ] **Step 7: Install into Local and restart**

```bash
npm run build && npm run install-addon
```

Then quit Local completely and relaunch it.

- [ ] **Step 8: Verify in Local**

1. Click **+** to create a new site.
2. Name it `mariadb-1188-test`, click **Continue**.
3. On the environment step choose **Custom**.
4. In the **Database** dropdown select **MariaDB 11.8.8**.
5. Complete site creation and wait for provisioning to finish.
6. Open **wp-admin → Tools → Site Health → Info → Database**.

Expected: `Server version: 11.8.8-MariaDB`.

If the version is absent from the dropdown, check Local's logs for `[local-addon-mariadb]` and confirm `~/Library/Application Support/Local/lightning-services/mariadb-11.8.8+0/` exists with a `bin/darwin-arm64/bin/` subdirectory.

- [ ] **Step 9: Record spike findings**

Create `docs/spikes/2026-08-05-mariadb-11x-findings.md` and fill in each heading from what actually happened. This is the deliverable that de-risks Task 4.

```markdown
# MariaDB 11.x Spike Findings (11.8.8)

## Build
Did the cmake flag set work unchanged? Any warnings about unknown options?

## Bootstrap
Did `--bootstrap` with `PASSWORD()` succeed? Exact error if not.

## Deprecation warnings
Did invoking the binaries as `mysqld`/`mysqladmin` emit "Deprecated program name"?
Did it affect `waitForDB()` or site provisioning, or was it log noise only?

## Character set
Did the utf8mb4 default (changed from latin1 in 11.8) cause any visible difference
in WordPress or in site provisioning?

## thread_stack
Did `thread_stack = 192K` in conf/my.cnf.hbs produce a warning about being below
the minimum? Was it raised automatically?

## Verdict
Safe to batch 10.11.18 / 11.4.12 / 12.3.2, or are changes needed first?
```

- [ ] **Step 10: Publish the release and commit findings**

Only after Step 8 passes:

```bash
gh release edit v11.8.8 --draft=false
git add docs/spikes/2026-08-05-mariadb-11x-findings.md
git commit -m "docs: record MariaDB 11.x spike findings"
git push
```

---

### Task 4: Batch 10.11.18, 11.4.12, and 12.3.2

**Files:**
- Modify: `src/constants.ts:10-14`
- Modify: `tests/main.test.ts:150-234` (the `10.11.11 service directory creation` describe block)
- Modify: `tests/downloader.test.ts` (the `10.11.11` URL test)

**Interfaces:**
- Consumes: `SUPPORTED_VERSIONS` from Task 3; the `release` job from Task 2.
- Produces: the final five-entry version array. Task 5 documents it.

- [ ] **Step 1: Write the failing tests**

In `tests/downloader.test.ts`, replace the `uses the correct URL for 10.11.11` test with:

```typescript
    it('uses the correct URL for 10.11.18', () => {
        const url = getBinaryUrl('darwin-arm64', '10.11.18');
        expect(url).toContain('/v10.11.18/');
        expect(url).toContain('bin-darwin-arm64-10.11.18.tar.gz');
    });
```

In the `SUPPORTED_VERSIONS` describe block added in Task 3, add:

```typescript
    it('contains exactly the five supported versions', () => {
        const { SUPPORTED_VERSIONS } = require('../src/constants');
        expect(SUPPORTED_VERSIONS.map((v: any) => v.version)).toEqual([
            '10.6.23', '10.11.18', '11.4.12', '11.8.8', '12.3.2',
        ]);
    });

    it('no longer offers 10.11.11 to fresh installs', () => {
        const { SUPPORTED_VERSIONS } = require('../src/constants');
        expect(SUPPORTED_VERSIONS.find((v: any) => v.version === '10.11.11')).toBeUndefined();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run build && npx jest tests/downloader.test.ts -v
```

Expected: FAIL — `contains exactly the five supported versions` reports a mismatch, and `no longer offers 10.11.11` reports the entry is still defined.

- [ ] **Step 3: Set the final version array**

In `src/constants.ts`, replace `SUPPORTED_VERSIONS` with:

```typescript
export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },  // EOL upstream 2026-07-06
    { version: '10.11.18', bundled: false },
    { version: '11.4.12',  bundled: false },
    { version: '11.8.8',   bundled: false },
    { version: '12.3.2',   bundled: false },
];
```

- [ ] **Step 4: Update main.test.ts for the 10.11 bump**

In `tests/main.test.ts`, the describe block at line 150 hardcodes `10.11.11` and will now fail. Rename it and update all four of its version references:

- Line 150: `describe('10.11.11 service directory creation', () => {` becomes `describe('10.11.18 service directory creation', () => {`
- Line 183: `it('creates the 10.11.11 service directory on startup', () => {` becomes `it('creates the 10.11.18 service directory on startup', () => {`
- Line 188: `'mariadb-10.11.11+0'` becomes `'mariadb-10.11.18+0'`
- Line 197: `it('writes 10.11.11-specific constants.js into the service dir', () => {` becomes `it('writes 10.11.18-specific constants.js into the service dir', () => {`
- Line 202: `userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'lib', 'constants.js'` becomes `userDataPath, 'lightning-services', 'mariadb-10.11.18+0', 'lib', 'constants.js'`
- Line 206: `expect(constants).toContain("'10.11.11'");` becomes `expect(constants).toContain("'10.11.18'");`
- Line 217: `userDataPath, 'lightning-services', 'mariadb-10.11.11+0', 'bin', 'darwin-arm64', 'bin'` becomes `userDataPath, 'lightning-services', 'mariadb-10.11.18+0', 'bin', 'darwin-arm64', 'bin'`
- Line 224: `it('triggers binary download for 10.11.11', () => {` becomes `it('triggers binary download for 10.11.18', () => {`
- Lines 229-230: in the comment, `For 10.11.11 it fires` becomes `For 10.11.18 it fires`

Verify none remain:

```bash
grep -n "10\.11\.11" tests/main.test.ts || echo "clean"
```

Expected: `clean`

`tests/serviceTemplate.test.ts` also references `10.11.11`, but only as an arbitrary argument to the generator functions — it never reads `SUPPORTED_VERSIONS`, so those tests still pass and are intentionally left alone.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run build && npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit and push**

```bash
git add src/constants.ts tests/main.test.ts tests/downloader.test.ts
git commit -m "feat: add MariaDB 10.11.18, 11.4.12, 12.3.2; drop 10.11.11"
git push
```

- [ ] **Step 7: Build and release all three**

Dispatch sequentially so a failure is easy to attribute. Each takes roughly 30-45 minutes.

```bash
for V in 10.11.18 11.4.12 12.3.2; do
  echo "=== Building $V ==="
  gh workflow run "Build MariaDB" -f mariadb_version="$V"
  sleep 20
  gh run watch "$(gh run list --workflow='Build MariaDB' --limit 1 --json databaseId -q '.[0].databaseId')"
done
```

Expected: three runs, each ending with `Release vX has 6 assets.`

If 12.3.2 fails at the smoke test, that is the new-major risk the spec called out. Capture the error and stop — do not publish a partial set.

- [ ] **Step 8: Confirm all three drafts have full asset sets**

```bash
for V in 10.11.18 11.4.12 12.3.2; do
  echo "v$V: $(gh release view "v$V" --json assets -q '.assets | length') assets"
done
```

Expected: `6 assets` for each.

- [ ] **Step 9: Verify 12.3.2 in Local**

12.3.2 is a new major series and gets its own manual check. 10.11.18 and 11.4.12 rely on CI plus the Task 3 findings.

```bash
npm run build && npm run install-addon
```

Quit and relaunch Local, then create a site named `mariadb-1232-test` on **MariaDB 12.3.2** and confirm **Tools → Site Health → Info → Database** reports `12.3.2-MariaDB`.

- [ ] **Step 10: Publish the three releases**

Only after Step 9 passes:

```bash
for V in 10.11.18 11.4.12 12.3.2; do
  gh release edit "v$V" --draft=false
done
gh release list --limit 10
```

Expected: six published releases — v10.6.23, v10.11.11, v10.11.18, v11.4.12, v11.8.8, v12.3.2. (v10.11.11 remains published so existing installs can still fetch its binaries, even though it is no longer offered to new sites.)

---

### Task 5: Update documentation

**Files:**
- Modify: `README.md:5-10` (version table), `:12-19` (platform table), `:24`, `:53`, `:63`, `:86`
- Modify: `package.json:5` (description)

**Interfaces:**
- Consumes: the final version array from Task 4.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Update the version table**

Replace the `## Supported MariaDB Versions` table in `README.md` with:

```markdown
## Supported MariaDB Versions

| Version | Status | Notes |
|---------|--------|-------|
| 10.6.23 | ⚠️ EOL | Bundled with Local; patched on startup. Community support ended 6 Jul 2026 — prefer a newer version for new sites. |
| 10.11.18 (LTS) | ✅ Stable | Downloaded on first use (~25 MB). Supported until Feb 2028. |
| 11.4.12 (LTS) | ✅ Stable | Downloaded on first use. Longest support window — until May 2029. |
| 11.8.8 (LTS) | ✅ Stable | Downloaded on first use. Supported until Jun 2028. Defaults to `utf8mb4`. |
| 12.3.2 (LTS) | ✅ Stable | Downloaded on first use. Newest LTS. |

Sites created on 10.11.11 with an earlier version of this addon keep working — that
service directory is left in place. It is no longer offered for new sites.
```

- [ ] **Step 2: Correct the platform table**

macOS Intel is listed as "Coming soon" but `bin-darwin-*.tar.gz` assets have shipped since June 2026. Replace the platform table with:

```markdown
## Platform Support

| Platform | Status |
|----------|--------|
| macOS Apple Silicon (arm64) | ✅ All versions |
| macOS Intel (x86_64) | ✅ All versions |
| Linux (x86_64) | ✅ All versions |
| Windows | ❌ Not supported |
```

- [ ] **Step 3: Fix the remaining hardcoded references**

- Line 24, requirements: `- Internet connection (binaries downloaded on first use for 10.11.11)` becomes `- Internet connection (binaries downloaded on first use for every version except 10.6.23)`
- Line 53, usage: `4. In the **Database** dropdown, select **MariaDB 10.6.23**` becomes `4. In the **Database** dropdown, select a MariaDB version (11.8.8 or 12.3.2 recommended for new sites)`
- Line 63, verification block: change `Server version: 10.6.23-MariaDB` to `Server version: 11.8.8-MariaDB`, and change the sentence above it to read "You should see the version you selected, for example:"
- Line 86, troubleshooting: the hardcoded `[GitHub Release](https://github.com/jpollock/local-addon-mariadb/releases/tag/v10.6.23)` becomes `[GitHub Releases](https://github.com/jpollock/local-addon-mariadb/releases)`

Also update the "Verifying Installation" and Known Limitations sections: remove the "macOS Intel: Binary build is in progress" bullet, since Step 2 now documents Intel as supported.

- [ ] **Step 4: Update the package description**

In `package.json`, replace:

```json
    "description": "Adds MariaDB 10.6.23 support to Local on macOS and Linux",
```

with:

```json
    "description": "Adds multiple MariaDB versions as database options in Local on macOS and Linux",
```

- [ ] **Step 5: Verify no stale references remain**

```bash
grep -n "Coming soon\|10\.6\.23 support\|for 10\.11\.11" README.md package.json || echo "clean"
```

Expected: `clean`

- [ ] **Step 6: Confirm tests and typecheck still pass**

```bash
npx tsc --noEmit && npm run build && npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 7: Commit and push**

```bash
git add README.md package.json
git commit -m "docs: document 10.11.18/11.4.12/11.8.8/12.3.2, flag 10.6.23 EOL, fix Intel status"
git push
```

---

## Done When

- `SUPPORTED_VERSIONS` lists exactly `10.6.23`, `10.11.18`, `11.4.12`, `11.8.8`, `12.3.2`.
- Six published GitHub releases exist, each new one with 6 assets; v10.6.23's missing checksums are backfilled.
- `npm test` and `npx tsc --noEmit` pass.
- 11.8.8 and 12.3.2 each provision a working WordPress site in Local and report the matching server version in Site Health.
- `docs/spikes/2026-08-05-mariadb-11x-findings.md` records the 11.x behaviour findings.
- README documents all five versions, flags 10.6.23 as EOL, and shows Intel as supported.

## Deferred

Tracked in the design spec, not this plan: the addon `.tgz` release pipeline, the `0.1.0` vs v1.1 version reconciliation, and switching to `mariadb-*` binary names.

---

### Task 6: Make the bootstrap share-file lookup version-agnostic

> **Execution order:** added mid-execution on 2026-08-05 after the 11.8.8 spike failed.
> This task must run BEFORE Task 3's build step is retried, and before any of Task 4's
> builds. It is numbered 6 only so the earlier task numbers already recorded in the
> ledger stay stable.

**Why:** MariaDB 11.x installs only `mariadb_system_tables.sql` and
`mariadb_system_tables_data.sql` into `share/`. The `mysql_*` names are absent entirely.
`bootstrapDatadir()` hardcodes the `mysql_*` names, so it throws ENOENT at site creation
on every 11.x/12.x build. 10.x still ships the `mysql_*` names, so both layouts must work
from one code path — `MariadbService.js` is copied into every service directory.

**Files:**
- Modify: `src/MariadbService.ts:106-122` (`bootstrapDatadir`)
- Modify: `.github/workflows/build-mariadb.yml` (smoke test SQL concatenation)
- Test: `tests/MariadbService.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `bootstrapDatadir()` resolving share SQL files under either naming scheme.
  Tasks 3 and 4 depend on this for every 11.x/12.x build.

- [ ] **Step 1: Write the failing tests**

Add to `tests/MariadbService.test.ts`:

```typescript
describe('share SQL file resolution', () => {
    const os = require('os');
    const fsExtra = require('fs-extra');
    const pathMod = require('path');

    function makeShareDir(files: Record<string, string>): string {
        const dir = fsExtra.mkdtempSync(pathMod.join(os.tmpdir(), 'mariadb-share-'));
        for (const [name, body] of Object.entries(files)) {
            fsExtra.writeFileSync(pathMod.join(dir, name), body);
        }
        return dir;
    }

    it('resolves the MariaDB 11.x layout (mariadb_* names)', () => {
        const dir = makeShareDir({
            'mariadb_system_tables.sql': '-- 11x tables',
            'mariadb_system_tables_data.sql': '-- 11x data',
        });
        const { resolveShareSql } = require('../src/MariadbService');
        expect(resolveShareSql(dir, 'system_tables')).toBe('-- 11x tables');
        expect(resolveShareSql(dir, 'system_tables_data')).toBe('-- 11x data');
        fsExtra.removeSync(dir);
    });

    it('resolves the MariaDB 10.x layout (mysql_* names)', () => {
        const dir = makeShareDir({
            'mysql_system_tables.sql': '-- 10x tables',
            'mysql_system_tables_data.sql': '-- 10x data',
        });
        const { resolveShareSql } = require('../src/MariadbService');
        expect(resolveShareSql(dir, 'system_tables')).toBe('-- 10x tables');
        expect(resolveShareSql(dir, 'system_tables_data')).toBe('-- 10x data');
        fsExtra.removeSync(dir);
    });

    it('prefers mariadb_* when both are present', () => {
        const dir = makeShareDir({
            'mariadb_system_tables.sql': '-- preferred',
            'mysql_system_tables.sql': '-- legacy',
        });
        const { resolveShareSql } = require('../src/MariadbService');
        expect(resolveShareSql(dir, 'system_tables')).toBe('-- preferred');
        fsExtra.removeSync(dir);
    });

    it('throws a diagnostic error naming both candidates when neither exists', () => {
        const dir = makeShareDir({ 'unrelated.sql': '' });
        const { resolveShareSql } = require('../src/MariadbService');
        expect(() => resolveShareSql(dir, 'system_tables')).toThrow(/mariadb_system_tables\.sql/);
        expect(() => resolveShareSql(dir, 'system_tables')).toThrow(/mysql_system_tables\.sql/);
        fsExtra.removeSync(dir);
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run build && npx jest tests/MariadbService.test.ts -t "share SQL file resolution" -v
```

Expected: FAIL — `resolveShareSql is not a function`.

- [ ] **Step 3: Implement**

In `src/MariadbService.ts`, add this exported function at module scope, after the imports
and before the class declaration:

```typescript
/**
 * Reads a share/ SQL init file, tolerating both naming schemes.
 * MariaDB 11.x installs only mariadb_*.sql; 10.x installs only mysql_*.sql.
 * `base` is the stem, e.g. 'system_tables' or 'system_tables_data'.
 */
export function resolveShareSql(shareDir: string, base: string): string {
    const candidates = [`mariadb_${base}.sql`, `mysql_${base}.sql`];
    for (const name of candidates) {
        const candidate = path.join(shareDir, name);
        if (fs.pathExistsSync(candidate)) {
            return fs.readFileSync(candidate, 'utf8');
        }
    }
    throw new Error(
        `MariaDB bootstrap: found neither ${candidates.join(' nor ')} in ${shareDir}`
    );
}
```

Then in `bootstrapDatadir()`, replace the two `fs.readFileSync` calls:

```typescript
        const systemTables = resolveShareSql(shareDir, 'system_tables');
        const systemData = resolveShareSql(shareDir, 'system_tables_data');
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run build && npm test
```

Expected: all tests pass, including the four new ones.

- [ ] **Step 5: Apply the same fallback in the CI smoke test**

In `.github/workflows/build-mariadb.yml`, inside the smoke-test step, replace the two
`cat install/share/mysql_*.sql` lines with a resolver. Insert before the `{ ... } > "$SMOKE/init.sql"`
block:

```bash
          pick_sql() {
            for n in "install/share/mariadb_$1.sql" "install/share/mysql_$1.sql"; do
              [ -f "$n" ] && { echo "$n"; return 0; }
            done
            echo "::error::neither mariadb_$1.sql nor mysql_$1.sql found in install/share" >&2
            return 1
          }
          TABLES_SQL=$(pick_sql system_tables) || exit 1
          DATA_SQL=$(pick_sql system_tables_data) || exit 1
          echo "Using $TABLES_SQL and $DATA_SQL"
```

Then change `cat install/share/mysql_system_tables.sql` to `cat "$TABLES_SQL"` and
`cat install/share/mysql_system_tables_data.sql` to `cat "$DATA_SQL"`.

- [ ] **Step 6: Validate the YAML parses**

```bash
ruby -ryaml -e "YAML.load_file('.github/workflows/build-mariadb.yml'); puts 'YAML OK'"
```

Expected: `YAML OK`

- [ ] **Step 7: Commit**

```bash
git add src/MariadbService.ts tests/MariadbService.test.ts .github/workflows/build-mariadb.yml
git commit -m "fix: resolve share SQL init files under both mariadb_* and mysql_* names"
```

**Regression note for the controller:** `MariadbService.js` is copied into every service
directory, including the working 10.6.23 and 10.11.11 ones. After this task, the 10.6.23
path must be re-verified in Local before the branch is considered done.
