# Head-reason similarity audit (D54)

UTC: 2026-11-08T01:58:11.446Z. Git head: 2f533df7539104750c06cd6c4e81550dca045d48.

Compare every old truthy exception with isSimilarityExemptReason, independent of clip kind; select exactly old-skipped/new-checked cells, remove only those reasons in memory and run the unchanged-source pipeline. Inventory retained D41 pose exemptions separately (not similarity passes). No source, export or backlog writes; all rerun input hashes rechecked. No findings are accepted by this report.

Old skipped cells: 116; newly checked: 29; retained D41 pose exemptions: 87 (unmeasured/exempt, not passes).

Projects: 1; cells: 29; pass: 11; fail: 18; unmeasured: 0.

Full input hashes and reproduction command: [JSON report](official-d54-audit.json).

| Project / direction      | Clip | Local cell | Former exception | Fresh similarity result                                       |
| ------------------------ | ---- | ---------- | ---------------- | ------------------------------------------------------------- |
| dan-phu-tu-chibi-v1 / SE | walk | 2          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | walk | 3          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | walk | 8          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | walk | 10         | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | walk | 11         | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | run  | 0          | posture          | FAIL: face similarity 0.65 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | run  | 1          | posture          | FAIL: face similarity 0.64 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | run  | 2          | posture          | FAIL: face similarity 0.65 < 0.7; torso similarity 0.68 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 3          | posture          | FAIL: face similarity 0.61 < 0.7; torso similarity 0.69 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 4          | posture          | FAIL: face similarity 0.57 < 0.7; torso similarity 0.69 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 5          | posture          | FAIL: face similarity 0.58 < 0.7; torso similarity 0.68 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 6          | posture          | FAIL: face similarity 0.55 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | run  | 7          | posture          | FAIL: face similarity 0.53 < 0.7; torso similarity 0.67 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 8          | posture          | FAIL: face similarity 0.53 < 0.7; torso similarity 0.68 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 9          | posture          | FAIL: face similarity 0.55 < 0.7; torso similarity 0.69 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 10         | posture          | FAIL: face similarity 0.56 < 0.7; torso similarity 0.69 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 11         | posture          | FAIL: face similarity 0.57 < 0.7; torso similarity 0.70 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 12         | posture          | FAIL: face similarity 0.55 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | run  | 13         | posture          | FAIL: face similarity 0.60 < 0.7; torso similarity 0.67 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 14         | posture          | FAIL: face similarity 0.59 < 0.7; torso similarity 0.68 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | run  | 15         | posture          | FAIL: face similarity 0.59 < 0.7; torso similarity 0.69 < 0.7 |
| dan-phu-tu-chibi-v1 / SE | dash | 1          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | dash | 2          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | dash | 3          | posture          | FAIL: face similarity 0.66 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | dash | 4          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | dash | 5          | posture          | FAIL: face similarity 0.64 < 0.7                              |
| dan-phu-tu-chibi-v1 / SE | dash | 6          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | dash | 7          | posture          | PASS                                                          |
| dan-phu-tu-chibi-v1 / SE | dash | 8          | posture          | PASS                                                          |
