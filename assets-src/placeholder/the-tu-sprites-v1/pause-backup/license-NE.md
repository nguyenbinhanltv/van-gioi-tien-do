<!-- THE-TU-SPRITES-NE:START -->

## Thể tu NE — sprite sheet từng frame (D41)

Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.

| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |
| --- | --- | --- | --- | --- | --- | --- |
| THES-NE-GEN: `assets-src/placeholder/the-tu-sprites-v1/NE/raw/*` | Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof | 2026-11-06T20:09:46.699Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-NE-SHEET: `assets-src/placeholder/the-tu-sprites-v1/NE/sheets/*; assets-src/placeholder/the-tu-sprites-v1/NE/templates/*` | THES-NE-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration | 2026-11-06T20:09:46.699Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-NE-QA: `assets-src/placeholder/the-tu-sprites-v1/NE/*.json; assets-src/placeholder/the-tu-sprites-v1/NE/quality-backlog.md; assets-src/placeholder/the-tu-sprites-v1/NE/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-NE.json` | THES-NE-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract | 2026-11-06T20:09:46.699Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-NE-RUNTIME: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_NE_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta` | THES-NE-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata | 2026-11-06T20:09:46.699Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-NE-REF: `assets-src/placeholder/the-tu-continuous-v1/reference/NE.master4x.png` | Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log | 2026-11-06T20:09:46.699Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |

### attack.attempt1.generation.json

```json

{
  "clip": "attack",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:55 UTC",
  "prompt": "Production ATTACK NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT FOUR equal SQUARE columns TWO rows,8 full-body frames rowmajor, aspect2:1. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame RIGHT PUNCH into upper-right awaydirection.1 guard;2 loadrightgauntlet;3 windback;4 extendrightpunch;5 fullimpactextension;6 retract;7 recover;8 exactguard. Rightneararm extends AWAY to upperright, torso rotates slightly but camera remainsrear3Q, no enlarged hand. Bootsplanted. Pure flat opaque#FF00FF, no scenery/shadows/floor/guides/text/ticks/particles/rocks/glow/afterimages. No weapon. All8completefigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/attack.template.png"
  ],
  "selectedOutput": "sheets/attack.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:22:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-9bd842c0-213d-452b-b336-c5b8ddb0b2ea.png",
  "originalBackup": "raw/originals/attack.attempt1.png"
}

```

### attack_2.attempt1.generation.json

```json

{
  "clip": "attack_2",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:55 UTC",
  "prompt": "Production ATTACK_2 NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT FOUR equal SQUARE columns TWO rows,8 full-body frames rowmajor, aspect2:1. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame LEFT PALM STRIKE into upperright awaydirection.1 guard;2 farleftgauntletdrawsback;3 hipsload;4 leftopenpalmextendsaway;5 fullimpact;6 retract;7 recover;8 exactguard. Nearrightgauntlet staysguardingribs. Camera remainsrear3Q, backcloudtabarddominant. Pure flat opaque#FF00FF, no scenery/shadows/floor/guides/text/ticks/particles/rocks/glow/afterimages. No weapon. All8completefigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/attack_2.template.png"
  ],
  "selectedOutput": "sheets/attack_2.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:21:51 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-bd3a897c-66ab-4ba9-a7c7-f95286a64ab1.png",
  "originalBackup": "raw/originals/attack_2.attempt1.png"
}

```

### attack_3.attempt1.generation.json

```json

{
  "clip": "attack_3",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:55 UTC",
  "prompt": "Production ATTACK_3 NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT FOUR equal SQUARE columns TWO rows,8 full-body frames rowmajor, aspect2:1. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame TWO-GAUNTLET GROUND SLAM.1 guard;2 fistsatshoulders;3 bothbronze fists raised ABOVE bun;4 kneesflexintoforwardstoop;5 bothgauntlets smashground beforefeet towardupperright;6 holdlow;7 rise;8 exactstandingguard. Full-size anatomy never shrinks when crouching, natural folds, no groundVFX. Pure flat opaque#FF00FF, no scenery/shadows/floor/guides/text/ticks/particles/rocks/glow/afterimages. No weapon. All8completefigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/attack_3.template.png"
  ],
  "selectedOutput": "sheets/attack_3.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:22:21 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-c807cda4-79f7-42ca-ad4d-1f1ba9ca82f1.png",
  "originalBackup": "raw/originals/attack_3.attempt1.png"
}

```

### cast.attempt1.generation.json

```json

{
  "clip": "cast",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:55 UTC",
  "prompt": "Production CAST NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT FOUR equal SQUARE columns TWO rows,8 full-body frames rowmajor, aspect2:1. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame standing EARTH PALM CAST.1 guard;2 palmsgatheratabdomen;3 risechest;4 gather;5 bothopenbronze palms pushAWAY upperright;6 hold;7 retract;8 exactguard. Keepfeetplanted, headheight214, backfacing camera throughout, no facefront. Pure flat opaque#FF00FF, no scenery/shadows/floor/guides/text/ticks/particles/rocks/glow/afterimages. No weapon. All8completefigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/cast.template.png"
  ],
  "selectedOutput": "sheets/cast.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:22:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-58b57f30-39df-4466-b835-367808b35a35.png",
  "originalBackup": "raw/originals/cast.attempt1.png"
}

```

### channel.attempt1.generation.json

```json

{
  "clip": "channel",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:25:10 UTC",
  "prompt": "Production CHANNEL NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT 4 equal SQUARE columns 2 rows,8 full-body frames rowmajor, aspect4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame seamless standingCHANNEL. Bothgauntlets held at abdomen infrontoftorso AWAYfromcamera, upperbackcloudemblem unobscured.1neutral;2inhale;3inhalepeak;4relax;5neutral;6exhale;7relax;8exactfirst. Bothbootsplanted, stable214unitstature. Pure flat opaque#FF00FF, NO borders or gridlines; removeALLtemplate marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages. No weapon. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/channel.template.png"
  ],
  "selectedOutput": "sheets/channel.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:26:12 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-b14804c7-296c-4eb6-be1d-d968d4a6069f.png",
  "originalBackup": "raw/originals/channel.attempt1.png"
}

```

### dash.attempt1.generation.json

```json

{
  "clip": "dash",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:25:10 UTC",
  "prompt": "Production DASH NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT 3 equal SQUARE columns 2 rows,6 full-body frames rowmajor, aspect3:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Six-frame DASH towardUPPERRIGHT away:1 standingguard;2 kneesbend/torsolean;3 launch;4 shallowairbornelunge;5 land;6 exactguard. Heavygauntlets at sides, natural leg reach, no shrinking anatomy. Pure flat opaque#FF00FF, NO borders or gridlines; removeALLtemplate marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages. No weapon. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/dash.template.png"
  ],
  "selectedOutput": "sheets/dash.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:25:33 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-2a9ce755-d22a-419e-8f23-0c59a9ae77a9.png",
  "originalBackup": "raw/originals/dash.attempt1.png"
}

```

### die.attempt1.generation.json

```json

{
  "clip": "die",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:27:41 UTC",
  "prompt": "Production DIE NE rear3Q sprite sheet. Image1 exact master, image2 layout/poseguide. EXACT 4 equal SQUARE columns 2 rows,8 full-body frames rowmajor, aspect4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frameDIE:1guard;2slump;3kneel;4bothkneesground;5leanontoleftarm;6collapseSIDEWAYS;7lyingonrightside;8exactsamefinalpose. StillrearNEcamera, headawayupperright, full-sizedbody whenlying, no miniaturecorpse. Alllimbssamephysicalsize; no blood. Pure flat opaque#FF00FF, NO borders/gridlines/template marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages/weapons. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/die.template.png"
  ],
  "selectedOutput": "sheets/die.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:29:25 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-64081090-9999-467e-b924-41f4c2333728.png",
  "originalBackup": "raw/originals/die.attempt1.png"
}

```

### emote.attempt1.generation.json

```json

{
  "clip": "emote",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:27:41 UTC",
  "prompt": "EDIT target image1 NE rear3Q sprite sheet. Image1 is acceptedidle EDIT TARGET, image2 masterreference. EXACT 4 equal SQUARE columns 2 rows,8 full-body frames rowmajor, aspect4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  EDIT image1 acceptedIDLEsheet intoEMOTEsalute. PRESERVE exactcanvas, figureheight, head/bunposition, legs/boots, torso, colors/camera inall8cells. ONLY change arms/gauntlets:1unchangedidle;2handsrise;3rightfistmeetsleftpalmatthechestAWAYfromcamera;4hold;5slightchinnodwithoutmovingbun;6returnchin;7handslower;8unchangedidle. Salute mostlyhiddeninfrontofchestfromrear; nearforearmmovesnaturally. Do NOT zoom/rescale/elongate legs. Image2 identityreferenceonly. Pure flat opaque#FF00FF, NO borders/gridlines/template marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages/weapons. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "sheets/idle.png",
    "../../the-tu-continuous-v1/reference/NE.master4x.png"
  ],
  "selectedOutput": "sheets/emote.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:29:26 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-16b3e0d7-3144-4d30-a7a5-7fabc5be1714.png",
  "originalBackup": "raw/originals/emote.attempt1.png"
}

```

### hit.attempt1.generation.json

```json

{
  "clip": "hit",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:25:10 UTC",
  "prompt": "Production HIT NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT 4 equal SQUARE columns 1 rows,4 full-body frames rowmajor, aspect4:1. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Four-frame HIT.1exactguard;2 shouldersrecoilbackwardtowardcamera withshallowkneeflex;3recover;4exactguard. No facefrontturn, maintainfull-sizebody, no impactVFX. Pure flat opaque#FF00FF, NO borders or gridlines; removeALLtemplate marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages. No weapon. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/hit.template.png"
  ],
  "selectedOutput": "sheets/hit.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:26:39 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-2733b1a4-531c-4d7b-9b0e-a6a3c1319955.png",
  "originalBackup": "raw/originals/hit.attempt1.png"
}

```

### idle.attempt1.generation.json

```json

{
  "clip": "idle",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:14:16 UTC",
  "prompt": "Production frame-by-frame IDLE NORTHEAST sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 EXACT rear NE identity/style master; image2 exact layout and leading-leg ghost guide. EXACTLY 4 equal SQUARE columns by 2 rows, 8 complete full-body cells row-major, sheet aspect 4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking. Eight-frame seamless IDLE: planted feet, tiny chest breathing and hand/cloth sway;1 calmguard,2 inhale,3 inhalepeak,4 relax,5 neutral,6 exhale,7 relax,8 exact1. Figure height214units throughout. Pure opaque flat#FF00FF background. Remove all template lines, ghostmarks, ticks, dots, borders, numbers and text. No shadows, floor, blur, effects, scenery, aura or afterimages. One whole figure percell, never clipped or merged across cells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/idle.template.png"
  ],
  "selectedOutput": "sheets/idle.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:15:04 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-6591cb43-3e56-4358-8b19-4c0e03422b10.png",
  "originalBackup": "raw/originals/idle.attempt1.png"
}

```

### meditate.attempt1.generation.json

```json

{
  "clip": "meditate",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:27:41 UTC",
  "prompt": "Production MEDITATE NE rear3Q sprite sheet. Image1 exact master, image2 layout/poseguide. EXACT 4 equal SQUARE columns 2 rows,8 full-body frames rowmajor, aspect4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  SEATED crosslegged meditation: standingmaster214units, seatedfigureonly150units, buny82 andbasey232. KeepEXACTsamehead42units, torso, arms, gauntletandleganatomicalsizes. Do NOT enlarge seatedfigure tostandingcellheight. Bigemptymagentaabovehead. Backstraight, full-sizelegsfoldcrosslegged, gauntletsrestonknees, backcloudmotifvisible. Eightframesgentlebreathing, lastsamefirst. Pure flat opaque#FF00FF, NO borders/gridlines/template marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages/weapons. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/meditate.template.png"
  ],
  "selectedOutput": "sheets/meditate.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:29:25 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-39df5ba7-8c10-480d-aabb-3404c83c8887.png",
  "originalBackup": "raw/originals/meditate.attempt1.png"
}

```

### run.attempt1.generation.json

```json

{
  "clip": "run",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:14:16 UTC",
  "prompt": "Production frame-by-frame RUN NORTHEAST sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 EXACT rear NE identity/style master; image2 exact layout and leading-leg ghost guide. EXACTLY 6 equal SQUARE columns by 2 rows, 12 complete full-body cells row-major, sheet aspect 6:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking. Twelve-frame RUN loop at table speed, in place facing awayupperright. Match leading-leg ghosts exactly.1 right contact;2 Rload;3 Rmidstance/Lpasses;4 Rpush/Lswings;5 brief flight;6 Lprecontact;7 left contact;8 Lload;9 Lmidstance/Rpasses;10 Lpush/Rswings;11 brief flight;12 Rprecontact returning1. Strong clear alternating rear leg silhouettes, separate boots, natural bent elbows with heavy gauntlets. Keep upperbody upright, shallow flex only: figure height208..220units (target214), same head/torso size, no deep compressed poses. Pure opaque flat#FF00FF background. Remove all template lines, ghostmarks, ticks, dots, borders, numbers and text. No shadows, floor, blur, effects, scenery, aura or afterimages. One whole figure percell, never clipped or merged across cells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/run.template.png"
  ],
  "selectedOutput": "sheets/run.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:15:04 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-9c0005dc-ebe5-426b-a8f4-aa230f2498a9.png",
  "originalBackup": "raw/originals/run.attempt1.png"
}

```

### run.attempt2.generation.json

```json

{
  "clip": "run",
  "dir": "NE",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:17:34 UTC",
  "prompt": "EDIT TARGET image1: twelve-frame NE run sheet, six equal SQUARE columns x two rows. Image2 identity master only. Change ONLY cells 4,10 (0-based) = row1 col5 and row2 col5. All other cells MUST remain exactly untouched; keep canvas/grid/camera/colors. These cells have excessive knee folding and lose upright height. Redraw only those full-body poses with SHALLOW knee flex and upright torso, while preserving exact same adult head/torso/limb sizes and the existing leg cycle: brief flight phase with one boot reaching DOWN to near ground instead of both legs deeply tucked. Target figure full-body height214units per256cell, allowed208..220. Groundy232, buny18. Match adjoining cells' standing stature. Do not zoom, resize, stretch or scale any figure. Re-articulate the legs naturally to recover body height. Preserve back three-quarter NE facing away/up-right, rear mountain-blue tabard/bronze cloud back motif, ivory trousers/sleeves, bronze gauntlets, jade bun, dark boots, sash band with hidden front knot. No new face or camera turn. All12 complete figures rowmajor, flat opaque#FF00FF background, no guide marks/text/effects/shadows. DO NOT change any cell outside the listed cells.",
  "references": [
    "raw/run.attempt1.png",
    "../../the-tu-continuous-v1/reference/NE.master4x.png"
  ],
  "selectedOutput": "raw/run.attempt2.edited.png",
  "repairCells": [
    4,
    10
  ],
  "status": "donor generated; apply listed cells only after QA",
  "utcEndObserved": "2026-11-06 19:18:24 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-fbb03bb3-fd5d-4102-9f6e-fb5de1b2e989.png",
  "originalBackup": "raw/originals/run.attempt2.png"
}

```

### run.attempt3.generation.json

```json

{
  "clip": "run",
  "dir": "NE",
  "attempt": 3,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:10 UTC",
  "prompt": "EDIT image1 run sheet, SIX square columns TWO rows. Only cells 10 zero-based (row2col5) need actual LEG REDRAW; last attempt left them unchanged. Keep all other pixels/cells unchanged. Inside each listed cell KEEP head, hair, torso, arms, gauntlets, tabard, and camera exactly as they are. Extend the SUPPORTING leg naturally DOWN: unfold knee and ankle so the dark boot sole reaches SAME GROUND LINE as cell1 (row1col2). DO NOT shrink or resize anything. Redraw the ivory trouser/shin/boot articulation only. Image2 shows correct anatomical identity. Per256cell supporting sole must be y232, buny18, totalheight214units. Current cell10height205 is too short because both boots are high. Add about9units of downward leg REACH by straightening the planted knee; keep full-sized anatomy and correct NE rear3Q facing awayupperright. Strong clear contact: ONE boot MUST touch y232. Other swingboot stays raised. Preserve original12-cell canvas, eachcell square, no enlargement ofhead/body. Paletteexactblueivorybronze, flat#FF00FF background, no text, effects, guide marks or shadows. Only requested cells change.",
  "references": [
    "raw/run.attempt2.selected.png",
    "../../the-tu-continuous-v1/reference/NE.master4x.png"
  ],
  "selectedOutput": "raw/run.attempt3.edited.png",
  "repairCells": [
    10
  ],
  "status": "donor generated; only specified cells may be applied",
  "utcEndObserved": "2026-11-06 19:20:57 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-e2be8c6f-05a9-4bdb-9580-c6351cd4ed8e.png",
  "originalBackup": "raw/originals/run.attempt3.png"
}

```

### sword_fly.attempt1.generation.json

```json

{
  "clip": "sword_fly",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:25:10 UTC",
  "prompt": "Production SWORD_FLY NE rear3Q sprite sheet. Image1 exact identity/camera master, image2 layoutguide. EXACT 4 equal SQUARE columns 2 rows,8 full-body frames rowmajor, aspect4:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Eight-frame seamless HOVER withoutswordorplatform.1 guardhover feet belowhips;2 rise2units;3 rise3;4 rise1;5 neutral;6 lower1;7 lower2;8 exactfirst. Relaxedgauntletsatsides. Same214unitanatomy, subtlecloth sway, no effects. Pure flat opaque#FF00FF, NO borders or gridlines; removeALLtemplate marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages. No weapon. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/sword_fly.template.png"
  ],
  "selectedOutput": "sheets/sword_fly.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:25:53 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-9a7147af-9bbc-4838-acac-e85e379e7f64.png",
  "originalBackup": "raw/originals/sword_fly.attempt1.png"
}

```

### tribulation.attempt1.generation.json

```json

{
  "clip": "tribulation",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:27:41 UTC",
  "prompt": "Production TRIBULATION NE rear3Q sprite sheet. Image1 exact master, image2 layout/poseguide. EXACT 6 equal SQUARE columns 2 rows,12 full-body frames rowmajor, aspect6:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking.  Twelve-frameTRIBULATION brace:1guard;2tense;3fistsrise;4crossedgauntletsinfrontofchestAWAYfromcamera;5shallowkneebend;6headlower;7deepbrace;8hold;9rise;10handslower;11guard;12exactfirst. Rearcloudemblemprominent, no lightning/effects. Full-sizeanatomy. Pure flat opaque#FF00FF, NO borders/gridlines/template marks/text/ghosts. No scenery/shadows/floor/particles/rocks/glow/afterimages/weapons. Allfigures sameanatomicalscale insideowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/tribulation.template.png"
  ],
  "selectedOutput": "sheets/tribulation.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:29:25 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-adb17e15-2b37-4b24-b058-77f4376f2d85.png",
  "originalBackup": "raw/originals/tribulation.attempt1.png"
}

```

### walk.attempt1.generation.json

```json

{
  "clip": "walk",
  "dir": "NE",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:14:16 UTC",
  "prompt": "Production frame-by-frame WALK NORTHEAST sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 EXACT rear NE identity/style master; image2 exact layout and leading-leg ghost guide. EXACTLY 6 equal SQUARE columns by 2 rows, 12 complete full-body cells row-major, sheet aspect 6:2. In EVERY cell use EXACT image1 rear THREE-QUARTER view facing diagonally AWAY from viewer toward screen UPPER-RIGHT / NORTHEAST. Back panel dominates, one tiny right cheek edge only, NO frontal face, NO turning toward camera. Stocky adult male earth tank, short darkbrown topbun and jade hairpin, ivory cross-collar robe/loose sleeves/trousers, mountain-blue short split tabard with bronze cloud emblem across UPPER BACK and bronze cloud hem trim, dark-blue waist sash BAND ONLY (front knot hidden), TWO sash tips partly hidden behind back tabard, dark boots, paired large bronze stone-block gauntlets with square meander emblems worn on hands. No sword/shield/platform/extra weapons. Exact master palette ivory#E9EEF0, blue#5E8798, sash#294451, bronze#B58A4A/shadow#5B4222/highlight#E3C07F. Fine ink outlines, clean 2-3 tone painterly cel shading, NW light. Same adult head size and stocky torso throughout. REDRAW natural limb anatomy per pose, no bent rubber cloth. FRAMING eachcell256units: bun top y18, boot sole ground y232, height214units, pelvis axis x126.89. Every frame IDENTICAL anatomical scale; no cell-specific zoom or shrinking. Twelve-frame WALK loop at table speed, in place facing awayupperright. Follow template leading-boot ghosts EXACTLY.1 right boot forward contact,2 Rload,3 Rmidstance/Lpassing,4 Rpush/Lswings,5 Lapproachescontact,6 passing intoL;7 left boot forward contact;8 Lload;9 Lmidstance/Rpassing;10 Lpush/Rswings;11 Rapproachescontact;12 returnRcontact. Clear alternating leg reversal; hips translate only slightly, no growth. Boots planted when ghost says contact. Keep headtop and bodyheight stable214units, no deep crouch. Pure opaque flat#FF00FF background. Remove all template lines, ghostmarks, ticks, dots, borders, numbers and text. No shadows, floor, blur, effects, scenery, aura or afterimages. One whole figure percell, never clipped or merged across cells.",
  "references": [
    "../../the-tu-continuous-v1/reference/NE.master4x.png",
    "templates/walk.template.png"
  ],
  "selectedOutput": "sheets/walk.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:15:03 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-337bde66-6823-4a1f-9c58-317cdc70c85a.png",
  "originalBackup": "raw/originals/walk.attempt1.png"
}

```

### walk.attempt2.generation.json

```json

{
  "clip": "walk",
  "dir": "NE",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:17:34 UTC",
  "prompt": "EDIT TARGET image1: twelve-frame NE walk sheet, six equal SQUARE columns x two rows. Image2 identity master only. Change ONLY cells 3,5,10 (0-based) = row1 col4, row1 col6, row2 col5. All other cells MUST remain exactly untouched; keep canvas/grid/camera/colors. These cells have excessive knee folding and lose upright height. Redraw only those full-body poses with SHALLOW knee flex and upright torso, while preserving exact same adult head/torso/limb sizes and the existing leg cycle: walking swing/push phase with supporting leg almost straight, not compressed. Target figure full-body height214units per256cell, allowed208..220. Groundy232, buny18. Match adjoining cells' standing stature. Do not zoom, resize, stretch or scale any figure. Re-articulate the legs naturally to recover body height. Preserve back three-quarter NE facing away/up-right, rear mountain-blue tabard/bronze cloud back motif, ivory trousers/sleeves, bronze gauntlets, jade bun, dark boots, sash band with hidden front knot. No new face or camera turn. All12 complete figures rowmajor, flat opaque#FF00FF background, no guide marks/text/effects/shadows. DO NOT change any cell outside the listed cells.",
  "references": [
    "raw/walk.attempt1.png",
    "../../the-tu-continuous-v1/reference/NE.master4x.png"
  ],
  "selectedOutput": "raw/walk.attempt2.edited.png",
  "repairCells": [
    3,
    5,
    10
  ],
  "status": "donor generated; apply listed cells only after QA",
  "utcEndObserved": "2026-11-06 19:18:24 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-712ed810-ef5d-4657-a87d-c4fa36e84f6b.png",
  "originalBackup": "raw/originals/walk.attempt2.png"
}

```

### walk.attempt3.generation.json

```json

{
  "clip": "walk",
  "dir": "NE",
  "attempt": 3,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:20:10 UTC",
  "prompt": "EDIT image1 walk sheet, SIX square columns TWO rows. Only cells 3,5,10 zero-based (row1col4,row1col6,row2col5) need actual LEG REDRAW; last attempt left them unchanged. Keep all other pixels/cells unchanged. Inside each listed cell KEEP head, hair, torso, arms, gauntlets, tabard, and camera exactly as they are. Extend the SUPPORTING leg naturally DOWN: unfold knee and ankle so the dark boot sole reaches SAME GROUND LINE as cell1 (row1col2). DO NOT shrink or resize anything. Redraw the ivory trouser/shin/boot articulation only. Image2 shows correct anatomical identity. Per256cell supporting sole must be y232, buny18, totalheight214units. Current cell3height202, cells5and10height205 is too short because both boots are high. Add about10..12units of downward leg REACH by straightening the planted knee; keep full-sized anatomy and correct NE rear3Q facing awayupperright. Strong clear contact: ONE boot MUST touch y232. Other swingboot stays raised. Preserve original12-cell canvas, eachcell square, no enlargement ofhead/body. Paletteexactblueivorybronze, flat#FF00FF background, no text, effects, guide marks or shadows. Only requested cells change.",
  "references": [
    "raw/walk.attempt2.selected.png",
    "../../the-tu-continuous-v1/reference/NE.master4x.png"
  ],
  "selectedOutput": "raw/walk.attempt3.edited.png",
  "repairCells": [
    3,
    5,
    10
  ],
  "status": "donor generated; only specified cells may be applied",
  "utcEndObserved": "2026-11-06 19:20:55 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-dea2c23d-8de1-4c4f-9e54-abd31025b35e.png",
  "originalBackup": "raw/originals/walk.attempt3.png"
}

```

<!-- THE-TU-SPRITES-NE:END -->
