# MariaDB Version Expansion — Design

**Date:** 2026-08-05
**Status:** Approved, ready for planning

## Goal

Offer four additional MariaDB versions in Local's database dropdown: **11.4.12**, **11.8.8**, **12.3.2**, and **10.11.18** (replacing 10.11.11). Keep the bundled 10.6.23 working while signalling that it is end-of-life upstream.

## Why now

MariaDB 10.6 reached community end-of-life on **6 July 2026**. It is the addon's bundled default, so the addon currently ships an unsupported version as its primary option. The addon's second version, 10.11.11, is also seven patches behind the current 10.11.18.

Support windows for the versions in scope:

| Version | Community EOL | Note |
|---------|---------------|------|
| 10.6 | 6 Jul 2026 | EOL — addon's bundled default |
| 10.11 | 16 Feb 2028 | addon currently ships .11, latest is .18 |
| 11.4 | 29 May 2029 | longest window — last release under the 5-year policy |
| 11.8 | 4 Jun 2028 | latest patch 11.8.8 (27 May 2026) |
| 12.3 | ≈May 2029 (derived) | newest LTS; start of the `.3 = LTS` numbering |

11.4 outlives 11.8 because MariaDB reduced LTS support from five years to three after 11.4.

## Architecture

No structural change. `SUPPORTED_VERSIONS` in `src/constants.ts` already drives the whole pipeline:

- `main.ts` loops the array, patching bundled versions and generating service directories for the rest
- `serviceTemplate.ts` writes a version-pinned `package.json`, `main.js`, and `constants.js` per service dir
- `downloader.ts` fetches `bin-{platform}-{version}.tar.gz` from the `v{version}` GitHub release

Adding a version is therefore a data change plus one trip through the build-and-release pipeline. The design's substance is in *sequencing* and *validation*, not in new code.

### Final version list

```ts
export const SUPPORTED_VERSIONS: ServiceVersion[] = [
    { version: '10.6.23',  bundled: true  },  // EOL upstream 2026-07-06
    { version: '10.11.18', bundled: false },
    { version: '11.4.12',  bundled: false },
    { version: '11.8.8',   bundled: false },
    { version: '12.3.2',   bundled: false },
];
```

`ServiceVersion` gains no new fields. EOL status lives in documentation only — Local derives dropdown labels from each service directory's `productName`, and altering that risks disturbing the `isAddonLoaded` dedup behaviour that required three separate fixes to get right (`d978d9e`).

### 10.11.11 migration

`10.11.11` is removed from the array rather than retained alongside 10.11.18.

`main.ts` only creates and patches service directories; it has no delete path. So an existing `mariadb-10.11.11+0` directory in a user's `userDataPath` survives untouched, and any site already provisioned against it keeps working. Fresh installs never create it and see only 10.11.18.

Deleting the old directory was rejected: Local records the lightning-service version per site, so removal would break existing sites. Conditional cleanup — deleting only when unreferenced — was rejected as requiring a dependency on Local's undocumented internal site registry.

## Phasing

The cmake flag set in `build-mariadb.yml` is proven on 10.6 and 10.11 only. Rather than commit twelve build jobs and four releases to an unproven configuration, one version goes end-to-end first.

### Phase 1 — spike 11.8.8

1. **Harden the CI smoke test.** Replace `mysqld --version` with a check that mirrors `bootstrapDatadir()` (`src/MariadbService.ts:106-154`): the same `--no-defaults --bootstrap` invocation against the same init SQL, including the `PASSWORD()` call, followed by starting the server and pinging it. This is the code path most likely to break on 11.x, and CI currently cannot see it.
2. **Add a release job** to `build-mariadb.yml` (see below).
3. **Dispatch for 11.8.8.** Verify the draft release has all six assets, then publish.
4. **Wire it in.** Add the entry, `npm run build`, `npm run install-addon`, restart Local.
5. **Verify in Local.** Create a WordPress site on 11.8.8; confirm provisioning succeeds and **Tools → Site Health → Info → Database** reports `11.8.8-MariaDB`.
6. **Record findings** on the three known 11.x behaviour changes listed under Risks.

### Phase 2 — batch the rest

10.11.18, 11.4.12, and 12.3.2 through the proven pipeline. 12.3.2 gets its own Local verification because it is a new major series; 10.11.18 and 11.4.12 rely on CI plus the Phase 1 findings.

## Release automation

The repository has no release pipeline. `build-mariadb.yml` stops at `actions/upload-artifact` with seven-day retention, and `ci.yml` only runs typecheck, build, and tests. Both existing releases were assembled by hand — every asset lists `jpollock` as uploader, not `github-actions[bot]` — which is how v10.6.23 came to be missing three of its six files.

Phase 1 adds a `release` job:

- **Gated** on all three platform builds succeeding. `needs: build` provides this on its own: although `fail-fast: false` lets every matrix leg run to completion, the `build` job as a whole still concludes as failed if any leg fails, which skips `release`. No additional gating logic is needed.
- **Draft by default.** `downloader.ts` has no rollback: once a release is live, any Local instance needing those binaries fetches them. Publishing happens after the Local smoke test.
- **Idempotent.** A re-dispatch of an already-released version must not fail. `gh release create` errors when the tag exists, so the job creates the release only when absent and always uploads with `--clobber`. This is what makes the v10.6.23 checksum backfill a plain re-dispatch rather than manual surgery.

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
      - uses: actions/download-artifact@v4
        with: { path: artifacts, merge-multiple: true }
      - name: Create draft release if absent
        run: |
          gh release view "$TAG" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1 || \
            gh release create "$TAG" \
              --repo "$GITHUB_REPOSITORY" \
              --title "MariaDB ${{ inputs.mariadb_version }}" \
              --notes "Prebuilt MariaDB ${{ inputs.mariadb_version }} binaries." \
              --draft
      - name: Upload assets
        run: gh release upload "$TAG" --repo "$GITHUB_REPOSITORY" --clobber artifacts/*
      - name: Verify asset count
        run: |
          COUNT=$(gh release view "$TAG" --repo "$GITHUB_REPOSITORY" \
            --json assets -q '.assets | length')
          [ "$COUNT" -eq 6 ] || { echo "Expected 6 assets, found $COUNT"; exit 1; }
```

The asset-count check is the direct guard against the v10.6.23 defect: a release that silently lands with four of six files now fails the job.

## Risks

**Cleared during design:**

- `PASSWORD()` and `mysql_native_password` both remain functional in MariaDB 11.8 and 12.3. The removals commonly cited belong to MySQL 8.0/9.0. The bootstrap SQL is safe.
- The `mysql_install_db` → `mariadb-install-db` rename does not apply: on macOS and Linux the addon bypasses that tool entirely and pipes SQL into `mysqld --bootstrap`.

**Open, to be characterised during the Phase 1 spike:**

- **Deprecated program names.** `MariadbService.ts:30-53` invokes binaries as `mysqld`, `mysql`, `mysqladmin`. MariaDB 11.4+ writes a "Deprecated program name" warning to stderr. Expected to be cosmetic, since checks are exit-code based, but `waitForDB()` must be confirmed unaffected. Switching to `mariadb-*` names is deliberately out of scope: the workflow's packaging list omits `mariadb-admin`, `mariadb-dump`, and `mariadb-check`, so the change would require rebuilding and re-releasing every version.
- **utf8mb4 default.** MariaDB 11.8 changes the default character set from latin1 to utf8mb4. Expected to be neutral-to-positive for WordPress, but it is a real behaviour change.
- **`thread_stack = 192K`** in `conf/my.cnf.hbs` may fall below the 11.x minimum. MariaDB raises it with a warning rather than failing, so this should be observable but not fatal.
- **Unproven build flags.** Several `WITHOUT_*` cmake options reference engines removed years ago. Unknown cmake variables are ignored, so this is expected to be harmless, but 12.3 in particular has never been built with this configuration.

## Testing

**Unit.** `constants.ts` is data-only, but `tests/main.test.ts` and `tests/serviceTemplate.test.ts` assert against the version list and require updating for the new entries.

**CI.** The hardened smoke test exercises bootstrap and startup per platform on every build.

**Manual, per version, in Local.** Create a WordPress site on the version; confirm provisioning completes; confirm Site Health reports the matching server version. Required for 11.8.8 and 12.3.2; optional for 10.11.18 and 11.4.12.

## Incidental fixes

Small defects found while exploring, folded in because they touch the same files:

- Backfill v10.6.23's three missing `.sha256` files by re-dispatching that version. The idempotent release job uploads into the existing published release with `--clobber`; it does not attempt to recreate the tag.
- Correct the README platform table: macOS Intel is listed as "🔄 Coming soon" but `bin-darwin-*.tar.gz` assets already ship for both releases.
- Update `package.json`'s description, which still reads "Adds MariaDB 10.6.23 support to Local on macOS and Linux".
- Add the three new versions and a 10.6.23 EOL note to the README version table.

## Out of scope

- **Addon release pipeline.** There is no `.tgz` packaging, no `files` field, and no tag-triggered workflow, so the addon can only be installed from source. `bundledDependencies` is already declared for all five runtime deps, so the groundwork exists. This gets its own spec after the versions land.
- **Version reconciliation.** `package.json` says `0.1.0` while `docs/plans/` and the README describe the work as v1.1. Belongs with the release-pipeline spec.
- **Switching to `mariadb-*` binary names.** See Risks.

## References

- [MariaDB EOL dates](https://endoflife.date/mariadb)
- [MariaDB 11.8 LTS release](https://mariadb.org/11-8-lts-released/)
- [MariaDB 11.8 changes and improvements](https://mariadb.com/docs/release-notes/community-server/11.8/what-is-mariadb-118)
- [mariadb-install-db documentation](https://mariadb.com/docs/server/clients-and-utilities/deployment-tools/mariadb-install-db)
