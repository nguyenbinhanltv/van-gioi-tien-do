# Quality backlog: kiem-tu

Generated from `quality-backlog.json` (1 accepted soft finding). Hard gates (frames, upright height, similarity, loop seam, export) are never listed. A listed finding passes as a warning while its value is no worse than recorded.

| clip | dir | cell | gate   | metric           | value | limit | status | note                                                                                                                                                                            |
| ---- | --- | ---- | ------ | ---------------- | ----- | ----- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| hit  | N   | 2    | height | height_excess_px | 6.8   | 0     | open   | D41 first pass: retain hit recoil height195px free-pose warning without per-frame scaling. Directional foot slide remains explicitly UNMEASURED; no speed or threshold changes. |

## Manual art findings (4)

Visual observations; automatic metric pruning never resolves these.

| clip | dir | cells | kind          | severity | reviewer   | art status | note                                                                                                                                                                                 |
| ---- | --- | ----- | ------------- | -------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| run  | N   | all   | weak_reversal | warn     | art-worker | open       | Long back robe obscures thighs; boot alternation reads subtly and needs future gait polish. Legacy art diagnostic: kind="leg_reversal"; status="open"                                |
| walk | N   | all   | other         | info     | art-worker | open       | Directional foot slide UNMEASURED pending source-ground registration and direction-correct vertical keep QA guides. Legacy art diagnostic: kind="contact_phase"; status="open"       |
| hit  | N   | 2     | other         | warn     | art-worker | open       | Recoil frame measures195px, outside upright band; free-pose soft warning retained without per-frame scaling. Legacy art diagnostic: kind="other"; status="open"                      |
| die  | N   | 5     | redraw_drift  | warn     | art-worker | open       | Side fall exposes a small cheek sliver compared with the full-back standing master; costume and right-hand sword retained. Legacy art diagnostic: kind="redraw_drift"; status="open" |
