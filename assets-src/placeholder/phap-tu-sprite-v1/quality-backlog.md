# Phap Tu A quality backlog

First production pass under D41. Cell indices are zero-based, row-major. Raw QA findings remain unchanged; footSlide is an allowed soft finding for this pass. Height, presence, similarity, loop seam, and real Cocos loading remain hard gates.

| Direction | Clip       | Cell / transition | Finding               | Measurement                                          | Status / next action                                                                  |
| --------- | ---------- | ----------------- | --------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| E         | walk       | 0 -> 1, R foot    | footSlide             | 19.2 px/frame; limit 3                               | Soft backlog; repair planted-foot travel in later gait pass                           |
| E         | walk       | 2 -> 3, R foot    | footSlide             | 3.0 px/frame rounded; raw value exceeds 3            | Soft backlog; retain raw contract value                                               |
| E         | walk       | 4 -> 5, L foot    | footSlide             | 10.4 px/frame; limit 3                               | Soft backlog                                                                          |
| E         | walk       | 5 -> 6, L foot    | footSlide             | 3.9 px/frame; limit 3                                | Soft backlog                                                                          |
| E         | walk       | 6 -> 7, L foot    | footSlide             | 5.8 px/frame; limit 3                                | Soft backlog                                                                          |
| E         | run        | 3                 | Height                | Originally 190 px; required 201.8..214.2, master 208 | FIXED by local anatomy redraw; hard gate passes; unchanged other-cell hashes verified |
| E         | run        | 8                 | Height                | Originally 187 px; required 201.8..214.2, master 208 | FIXED by local anatomy redraw; hard gate passes; unchanged other-cell hashes verified |
| NE        | turnaround | 3                 | Staff hand continuity | 1 suspect view out of 5                              | Verify anatomical right-hand grip before selecting NE master                          |

Idle: 12/12 present, no data QA findings; real Cocos Creator 3.8.8 capture loaded at zoom 2, midpoint samples, 12 frames. Walk and run: hard data gates pass under the same character calibration after documented whole-sheet DPI normalization and two cell-local run redraws. Production is incomplete; ungenerated clips and directions have no acceptance claim.
