# Contributing

## Git LFS for binary assets

Binary assets (images, textures, audio, fonts, Spine binaries, 3D/source files, zips) are stored with
[Git LFS](https://git-lfs.com). The tracked patterns live in the root `.gitattributes`.

### One-time setup

```sh
git lfs install        # once per machine
git clone <repo>       # LFS files are fetched automatically
# existing clone: git lfs pull
```

Then use git as usual (`git add`, `commit`, `push`). Check what is tracked with `git lfs ls-files`
and `git lfs track`.

### Rules

- **Exceptions:** `docs/**` (existing diagrams) and test fixtures (`**/fixtures/**`, `**/__fixtures__/**`,
  `**/testdata/**`) are *not* LFS, so tests can read them with `fs`. Put test binaries there.
- **No history rewrite:** never run `git lfs migrate`. Binaries committed before LFS was enabled stay as
  normal blobs; only new files go to LFS.
- **Text stays text:** `.atlas`, `.json`, Cocos `.meta` files are not LFS.
- CI checks out with `lfs: true`. Any new workflow that needs real asset bytes must do the same.

### GitHub free-tier quota

GitHub Free gives **1 GB LFS storage and 1 GB bandwidth per month** (shared across the repo owner's
account; CI checkouts and clones count toward bandwidth). When exceeded, LFS downloads and pushes of LFS
objects fail with a quota error. What to do:

1. Check usage: GitHub → Settings → Billing → Git LFS Data.
2. Buy a data pack (+50 GB storage/bandwidth, paid monthly) — the quickest fix.
3. Reduce usage: compress art (pngquant, KTX2/ASTC for runtime textures, ogg instead of wav), keep
   source files (psd/blend) out of the repo, and don't commit unneeded intermediate exports.
4. Reduce CI bandwidth: restrict `lfs: true` to jobs that need assets, or cache `.git/lfs`.
5. Last resort: move large sources to external storage (S3/R2/Drive) and reference them by URL/hash.

Quota resets monthly (bandwidth only); storage is freed only by deleting objects (contact GitHub support
after removing refs), so prefer not to commit throwaway binaries.
