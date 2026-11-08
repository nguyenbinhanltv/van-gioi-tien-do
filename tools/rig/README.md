# @vgtd/rig

AI animation authoring toolkit (D35/D36). Format-neutral rig in, DragonBones 5.5 out, with an automated QA gate.
Pipeline and conventions: [`docs/art/rig-pipeline.md`](../../docs/art/rig-pipeline.md) (Vietnamese).

```ts
import { authorKiemTuSet, buildCharacterPackage, buildReferenceHumanoid } from '@vgtd/rig';

const rig = buildReferenceHumanoid('E'); // or a validated kiem-tu.rig.json
const clips = authorKiemTuSet(rig); // idle, run, attack x3, cast, hit, die
const { export: db, reports } = buildCharacterPackage([{ rig, clips }], atlas, { name: 'kiemtu' });
// db.ske / db.tex are the DragonBones JSON objects; reports hold the QA findings
```

| Module               | Purpose                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `schema`, `validate` | `RigDocument` types, JSON Schema, `validateRig` (refs, paperdoll draw order, docs/03 limits) |
| `clip`, `pose`       | Clip model (deltas from rest, 30 fps keys), pose evaluation with 1/2-bone IK                 |
| `dsl`, `principles`  | `ClipBuilder` on bone roles, easing presets, anticipation / settle / overlap / hold / arc    |
| `locomotion`         | `planFeet`: IK foot planting without sliding, gait cycle, crouch and bob                     |
| `secondary`, `loop`  | Spring-chain baking (hair, sash, ...) to keys; loop-seam closing and measurement             |
| `animset`, `kiemtu`  | 13-animation table converted to 30 fps specs; the Kiếm tu set                                |
| `qa`, `pipeline`     | Headless sampler checks; `buildCharacterPackage` = validate → QA gate → export               |
| `dragonbones`        | ske.json + tex.json exporter (y-up/CCW → y-down/CW at the file boundary)                     |

Tests: `npm test -w @vgtd/rig`. Tests that load the export into the real Cocos 3.8.8 DragonBones runtime run only
when the editor is installed (default `C:/ProgramData/cocos/editors/Creator/3.8.8`, or set `COCOS_CREATOR_PATH`);
they are skipped in CI.

Review artifacts (sheets, GIFs, QA report, DragonBones JSON): `RIG_ARTIFACT_DIR=out RIG_DATA_DIR=<data> npm run artifacts -w @vgtd/rig`.
