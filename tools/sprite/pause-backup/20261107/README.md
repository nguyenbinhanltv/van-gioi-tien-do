# Worker 22 pause backup (2026-11-07)

Implementation PRs already pushed: #122 multi-page / MaxRects / Cocos loader, #123 directional QA, #124 manual findings. Exact heads are in backup-manifest.json. Do not modify frozen PR heads before orchestrator approval or review feedback. No image-generation call was running.

Saved: 15-clip real Cocos 3.8.8 two-page S capture proof (15 GIFs and 15 original 2x contact sheets), frozen exported runtime files, repaired-S QA contract, original and repaired S projects with all referenced sheets/master/templates/backlog copied and project paths rewritten relative, curated 29-entry manual companion and migrated backlog snapshot, and diagnostic/reproduction scripts/logs. Original project JSON and source-path maps preserve provenance. Temp-script absolute paths are historical: use the portable inputs/*/project.json for restoration.

Resume ONLY after orchestrator says RESUME. Fetch this WIP branch and the three recorded implementation branches; inspect PR #122/#123/#124 review and merge states. Handle authorized review feedback, or await review-harness repair. After each merge notify workers 17/18/20/21 with ao send --steer. Worker 17 should import its LATEST curated companion after #124 lands, not replace live data with this snapshot. Re-run batch/review from merged main. For frozen multi-page repro, use inputs/original-S/project.json with #122 exporter; do not substitute repaired art into the historical capture proof.

Raw art generation ownership remains with workers 17/18/20/21; this backup includes every input needed for worker 22's frozen S proof, not their entire ongoing 75-clip production sets. Those workers are separately responsible for production-source backups.
