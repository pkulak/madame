# GitHub Release Workflow — Design

## Goal

A single GitHub Actions workflow that, on every `v*` tag push, builds Madame for Windows (x86_64), Linux (x86_64), and macOS (aarch64), then publishes a GitHub Release with the three artifacts attached and auto-generated release notes. The workflow lives at `.github/workflows/release.yml`.

## Scope

In:
- Tag-triggered workflow (`v*`).
- Builds for `windows-latest` (x86_64), `ubuntu-latest` (x86_64), `macos-latest` (aarch64 / Apple Silicon).
- Outputs:
  - `madame-<version>-x86_64-windows.zip` containing `madame.exe`
  - `madame-<version>-x86_64-linux.tar.gz` containing the binary + icon set under a `madame/` top-level directory
  - `madame-<version>-aarch64-darwin.zip` containing `Madame.app`
- Version-validation gate: tag (e.g. `v0.2.0`) must match `version` in `src-tauri/tauri.conf.json`. Build is skipped on mismatch.
- Atomic release publish: all three artifacts uploaded in one `gh release create` call.

Out (deliberate non-goals):
- Code signing (macOS notarization, Windows Authenticode). Users will see "unidentified developer" / SmartScreen warnings on first launch. Signing is a separate workstream — needs Apple Developer Program membership, an EV certificate for Windows, and secrets management.
- Auto-updater manifests. Tauri's updater plugin is bundle-oriented and needs signed manifests; out of scope.
- Architectures beyond the three listed. Apple Silicon Mac users only; Intel Macs and ARM Linux/Windows are not built.
- Cross-checking version drift between `tauri.conf.json`, `package.json`, and `Cargo.toml`. Could be a pre-commit hook later.
- A `.deb`, AppImage, MSI, or NSIS installer. The Linux/Windows artifacts are raw binaries packaged in archives.
- Bundling installers on Windows/Linux. Mac is the only platform that gets a real OS-level package (`.app`).

## Trigger and distribution

```yaml
on:
  push:
    tags:
      - "v*"
```

The workflow creates a published (non-draft, non-prerelease) GitHub Release. Release notes are auto-generated from commits since the previous tag via `gh release create --generate-notes`.

## Workflow shape

Five jobs:

```
                push tag v*
                     │
                     ▼
         ┌────────────────────┐
         │ validate-version   │   (ubuntu-latest)
         │  assert tag == ver │
         └─────────┬──────────┘
                   │ on success
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌─────────┐ ┌─────────┐ ┌──────────┐
   │ build-  │ │ build-  │ │ build-   │
   │ windows │ │ linux   │ │ macos    │
   └────┬────┘ └────┬────┘ └────┬─────┘
        │           │           │
        └───────────┼───────────┘
                    ▼
            ┌───────────────┐
            │   release     │  (gh release create + upload)
            └───────────────┘
```

Job dependencies expressed via `needs:`. The `release` job has `needs: [build-windows, build-linux, build-macos]` and no `if: always()`, so a failed build in any platform aborts the release — no partial publishes.

The split between "build jobs upload artifacts via `actions/upload-artifact`" and "release job downloads them and creates the release" exists because GitHub release creation needs all files in one call to keep the release atomic. Creating the release in the first build job and appending in the others would leave a broken half-release published if a later job failed.

## Per-job details

All three build jobs declare `needs: validate-version` and read the validated version via `${{ needs.validate-version.outputs.version }}`, exposed inside steps as a `VERSION` env var. The same value is what was checked against the tag, so archives are guaranteed to be named consistently with the tag that triggered the build.

### `validate-version` (`ubuntu-latest`)

```yaml
- uses: actions/checkout@v4
- name: Validate tag matches tauri.conf.json version
  id: version
  run: |
    TAG_VERSION="${GITHUB_REF_NAME#v}"
    FILE_VERSION="$(jq -r .version src-tauri/tauri.conf.json)"
    if [ "$TAG_VERSION" != "$FILE_VERSION" ]; then
      echo "::error::Tag version ($TAG_VERSION) does not match tauri.conf.json version ($FILE_VERSION)"
      exit 1
    fi
    echo "version=$TAG_VERSION" >> "$GITHUB_OUTPUT"
```

`tauri.conf.json` is the single source of truth — Tauri reads it for the in-app version, so it's the version users see. The job exposes `version` as an output that build jobs consume to name their archives, avoiding three independent re-parsings of the tag.

### `build-windows` (`windows-latest`)

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2`
3. `dtolnay/rust-toolchain@stable`
4. `Swatinem/rust-cache@v2` with `workspaces: src-tauri`
5. `bun install --frozen-lockfile`
6. `bun tauri build --no-bundle`
7. Zip `src-tauri/target/release/madame.exe` → `madame-<version>-x86_64-windows.zip` using PowerShell `Compress-Archive`. The `.exe` sits at the zip root for now; if more files appear later (e.g. config templates, sidecar binaries) they'll move under a `madame/` top-level directory matching the Linux tarball.
8. `actions/upload-artifact@v4` with name `windows`

### `build-linux` (`ubuntu-latest`)

1. `actions/checkout@v4`
2. Install Tauri 2's documented Linux system deps. Most of these are pre-installed on `ubuntu-latest`; listing them all explicitly is defensive against future runner-image changes:
   ```bash
   sudo apt-get update
   sudo apt-get install -y \
     libwebkit2gtk-4.1-dev \
     libgtk-3-dev \
     libayatana-appindicator3-dev \
     librsvg2-dev \
     libxdo-dev \
     libssl-dev \
     build-essential \
     curl wget file
   ```
3. `oven-sh/setup-bun@v2`
4. `dtolnay/rust-toolchain@stable`
5. `Swatinem/rust-cache@v2` with `workspaces: src-tauri`
6. `bun install --frozen-lockfile`
7. `bun tauri build --no-bundle`
8. Stage and tar:
   ```bash
   mkdir -p staging/madame/icons
   cp src-tauri/target/release/madame staging/madame/madame
   cp src-tauri/icons/32x32.png         staging/madame/icons/
   cp src-tauri/icons/64x64.png         staging/madame/icons/
   cp src-tauri/icons/128x128.png       staging/madame/icons/
   cp src-tauri/icons/128x128@2x.png    staging/madame/icons/
   cp src-tauri/icons/icon.png          staging/madame/icons/
   tar -czf "madame-${VERSION}-x86_64-linux.tar.gz" -C staging madame/
   ```
9. `actions/upload-artifact@v4` with name `linux`

### `build-macos` (`macos-latest`, aarch64)

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2`
3. `dtolnay/rust-toolchain@stable` with `targets: aarch64-apple-darwin`
4. `Swatinem/rust-cache@v2` with `workspaces: src-tauri`
5. `bun install --frozen-lockfile`
6. `bun tauri build --bundles app`
7. Zip the `.app`:
   ```bash
   cd src-tauri/target/release/bundle/macos
   zip -r "madame-${VERSION}-aarch64-darwin.zip" Madame.app
   ```
8. `actions/upload-artifact@v4` with name `macos`

`macos-latest` is currently an Apple Silicon (M-series) runner — Intel Macs are not built. The macOS-specific Tauri config (`src-tauri/tauri.macos.conf.json`) already sets `bundle.active: true` with `targets: ["app"]`, which `--bundles app` matches.

### `release` (`ubuntu-latest`)

```yaml
release:
  needs: [validate-version, build-windows, build-linux, build-macos]
  runs-on: ubuntu-latest
  permissions:
    contents: write   # required to create releases
  steps:
    - uses: actions/download-artifact@v4
      with:
        path: artifacts
        merge-multiple: true
    - name: Create release
      env:
        GH_TOKEN: ${{ github.token }}
      run: |
        gh release create "$GITHUB_REF_NAME" \
          --repo "$GITHUB_REPOSITORY" \
          --title "$GITHUB_REF_NAME" \
          --generate-notes \
          artifacts/*
```

Notes:
- `permissions: contents: write` is scoped to this job only. Build jobs run with default read-only token permissions.
- `merge-multiple: true` flattens the three artifact uploads into one `artifacts/` directory so `artifacts/*` picks up all three files.
- `GH_TOKEN: ${{ github.token }}` uses the workflow's built-in token — no PAT, no secret to manage.
- Title is just the tag (e.g. `v0.2.0`); body comes from `--generate-notes`.

## Concurrency

```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

Prevents two rapid tag pushes from racing on the same release. `cancel-in-progress: false` because we don't want a later push (typically a mistake) to abort an in-flight build.

## Final artifact set on the release page

For a tag `v0.1.0`:

- `madame-0.1.0-x86_64-windows.zip` — extracts to `madame.exe`
- `madame-0.1.0-x86_64-linux.tar.gz` — extracts to `madame/{madame, icons/}`
- `madame-0.1.0-aarch64-darwin.zip` — extracts to `Madame.app`

## Edge cases

| Scenario | Behavior |
|---|---|
| Tag pushed without bumping `tauri.conf.json` version | `validate-version` fails immediately, no build minutes burned, no release created. |
| Re-running the workflow on an existing tag | `gh release create` fails with "release already exists." Intentional — silent overwrite is a footgun. To re-release, delete the GitHub release first. |
| One platform build fails, others succeed | `release` job does not run (no `if: always()`). No partial release published. The succeeded builds' artifacts remain on the workflow run for ~90 days for inspection. |
| Linux system deps drift in newer Ubuntu runners | Build fails at the apt-get step. Pin to a specific `ubuntu-24.04` image if this happens; for now `ubuntu-latest` is fine. |

## Coordination with the Nix flake

The Nix flake design (`docs/plans/2026-04-27-nix-flake-design.md`) was drafted assuming:
- Binary at the tarball root (`./madame`)
- A single `./icon.png` next to it
- No `.desktop` file in the tarball (flake generates one via `makeDesktopItem`)
- Artifacts for both `x86_64-linux` and `aarch64-linux`

This spec ships:
- A `madame/` top-level directory with the binary at `madame/madame`
- An `icons/` subdirectory with five PNG sizes (32, 64, 128, 128@2x, 512)
- No `.desktop` file (matches the flake's intent)
- Only `x86_64-linux` (per scope)

The flake design needs a follow-up edit to:
1. Update its `installPhase` to read from `madame/madame` and `madame/icons/<size>.png`.
2. Install all five icon sizes into the corresponding hicolor directories instead of just one.
3. Drop `aarch64-linux` from its system list, or accept that the package will fail to fetch on aarch64 until that architecture is added to the build matrix here.

These changes belong in a revision of the flake spec, not in this workflow.

## Verification

After implementation lands:

1. Push a throwaway tag (e.g. `v0.0.1-test`) on a branch with a matching `tauri.conf.json` version. Verify all three jobs succeed and a release is created with three artifacts. Delete the test release and tag afterward.
2. Push a tag whose version does not match `tauri.conf.json`. Verify `validate-version` fails and no build jobs run.
3. Download each artifact. Verify:
   - Windows zip extracts to a working `madame.exe` (run on a Windows machine).
   - Linux tarball extracts to `madame/madame` (executable) and `madame/icons/*.png`.
   - macOS zip extracts to `Madame.app` that launches (right-click → Open the first time, since unsigned).
4. Inspect the release notes — confirm `--generate-notes` produced a sensible "What's Changed" section from commits since the previous tag.

## Open questions

- **Pre-commit hook for cross-version sync.** `package.json` and `Cargo.toml` versions can drift from `tauri.conf.json` without triggering this workflow's validation. Worth a small hook later, but out of scope here.
- **First test tag.** Before merging, decide whether to test against a real `v0.1.x` tag or burn a `v0.0.1-test` tag and clean up. Less footprint with the latter.
