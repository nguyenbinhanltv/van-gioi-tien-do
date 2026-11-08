# Pháp tu B premium semi-chibi production

1. Correct the approved concept caveats, lock the T1 face, anatomy, fan hand and geometry, and produce five-direction turnaround plus T1–T5 front masters.
2. Adopt worker 27's merged v2 clip table and templates. Produce E first, one generated sheet per clip, with fixed character calibration and leading-leg guides.
3. Run all hard sprite QA gates, export and real Cocos Creator 3.8.8 capture at 2×. Record soft findings explicitly.
4. Merge current main, run repository verification and open one PR per direction. Later directions start from fresh main after their required masters/tooling land.

Only this new character path and its own export directory are used. Existing semi-realistic assets are preserved. Higher tiers/costumes must be image edits of the T1 motion sheets with identical poses. Body/weapon/FX layering follows D45 when merged.

Checkpoint: canonical masters and turnaround are visually approved. E merged in PR153 and SE in PR161, each with15 smooth-v2 clips /202frames and real Cocos3.8.8 capture. S now has all15 sources /202frames, zero hard QA failures,17 open locomotion foot findings and19 reviewed D47 INFO cells; all15 Cocos3.8.8 clips passed 2× capture with matching render hashes. NE and N follow from fresh main after S. Long-hair rear evidence uses the merged D50 rear-crown-shoulder and mandatory skull breadth against each untouched direction master.
