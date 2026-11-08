# Head-reason similarity audit (D54)

UTC: 2026-11-08T05:08:53.277Z. Git head: a33d420d4a2a29f93cd00159e59f7164d9fe42f5.

Compare every old truthy exception with isSimilarityExemptReason, independent of clip kind; select exactly old-skipped/new-checked cells, remove only those reasons in memory and run the unchanged-source pipeline. Inventory retained D41 pose exemptions separately (not similarity passes). No source, export or backlog writes; all rerun input hashes rechecked. No findings are accepted by this report.

Old skipped cells: 113; newly checked: 24; retained D41 pose exemptions: 89 (unmeasured/exempt, not passes).

Projects: 1; cells: 24; pass: 24; fail: 0; unmeasured: 0.

Full input hashes and reproduction command: [JSON report](similarity-audit.json).

| Project / direction    | Clip | Local cell | Former exception | Fresh similarity result |
| ---------------------- | ---- | ---------- | ---------------- | ----------------------- |
| thuong-tu-chibi-v1 / E | run  | 0          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 1          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 2          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 3          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 4          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 5          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 6          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 7          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 8          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 9          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 10         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 11         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 12         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 13         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 14         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | run  | 15         | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 0          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 1          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 2          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 3          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 4          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 5          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 6          | posture          | PASS                    |
| thuong-tu-chibi-v1 / E | dash | 7          | posture          | PASS                    |
