# Releasing

Maintainer-only docs for cutting a release and regenerating app icons.

## Tagged release workflow

Tagged builds are produced by the `Release` GitHub Actions workflow (`.github/workflows/release.yml`). On every `v*` tag push it builds for Windows (x86_64), Linux (x86_64), and macOS (aarch64 / Apple Silicon), then publishes a GitHub Release with three artifacts:

- `madame-<version>-x86_64-windows.zip` — extracts to `madame.exe`.
- `madame-<version>-x86_64-linux.tar.gz` — extracts to `madame/madame` plus a `madame/icons/` set (multiple PNG sizes for hicolor).
- `madame-<version>-aarch64-darwin.zip` — extracts to `Madame.app`.

## Cutting a release

1. Bump `"version"` in `src-tauri/tauri.conf.json` (e.g. `0.2.0`) and commit.
2. Push `main`.
3. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.

The workflow's first job validates that the tag — with the leading `v` stripped — equals the `version` field in `src-tauri/tauri.conf.json`. If they disagree, the workflow fails fast and no build minutes are spent.

> **Drift note:** only `tauri.conf.json` is validated. `package.json` and `Cargo.toml` versions are not cross-checked, but bump them in the same commit for consistency.

## Regenerating app icons

Two source images live under `src/public/`:

- `madame_logo.png` — transparent silhouette + M. Edit this when changing the artwork; it's also used in-app for the titlebar (rendered inverted on the dark titlebar).
- `madame_icon.png` — derived: `madame_logo.png` composited onto a rounded-square white background. Used as the source for all platform icons (Windows `.ico`, macOS `.icns`, Linux `.png`), matching the macOS dock icon convention. Don't hand-edit — regenerate it from `madame_logo.png`.

After editing `madame_logo.png`, regenerate everything in one command:

```bash
bun run icon
```

This runs `scripts/generate-icon.ts` (composites the squircle background to refresh `madame_icon.png`), then invokes `tauri icon src/public/madame_icon.png` to refresh every platform variant under `src-tauri/icons/`.

Tauri also emits Android/iOS and Microsoft Store assets that we don't ship — delete them after the regen:

```bash
rm -rf src-tauri/icons/android src-tauri/icons/ios
rm -f src-tauri/icons/Square*Logo.png src-tauri/icons/StoreLogo.png
```
