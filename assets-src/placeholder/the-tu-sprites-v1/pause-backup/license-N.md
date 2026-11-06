<!-- THE-TU-SPRITES-N:START -->

## Thể tu N — sprite sheet từng frame (D41)

Ảnh gốc giữ đầy đủ prompt/tool/model/CLI/UTC và image ID trong metadata. Không tạo lại mốc UTC chưa đo được; timestamp tệp gốc và thời điểm quan sát kết thúc được ghi riêng. UTC trong bảng dưới là lúc lập inventory, không phải lần sinh ảnh mới. Attribution chưa xác minh; không tuyên bố CC0/MIT cho ảnh. Mọi tệp là placeholder, phát hành `no`.

| Tệp / glob | Nguồn | UTC | Công cụ / mô hình | Chủ art tạm | Trạng thái | Phát hành? |
| --- | --- | --- | --- | --- | --- | --- |
| THES-N-GEN: `assets-src/placeholder/the-tu-sprites-v1/N/raw/*` | Original image_gen outputs, adjacent full prompt/UTC/image-ID records; deterministic recovery repair proof | 2026-11-06T20:09:47.272Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-N-SHEET: `assets-src/placeholder/the-tu-sprites-v1/N/sheets/*; assets-src/placeholder/the-tu-sprites-v1/N/templates/*` | THES-N-GEN; public @vgtd/sprite template and cell-local repair; frozen character calibration | 2026-11-06T20:09:47.272Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-N-QA: `assets-src/placeholder/the-tu-sprites-v1/N/*.json; assets-src/placeholder/the-tu-sprites-v1/N/quality-backlog.md; assets-src/placeholder/the-tu-sprites-v1/N/export/*; assets-src/placeholder/the-tu-sprites-v1/batch-N.json` | THES-N-SHEET; project clip-table timing, calibration, quality backlog and sprite export contract | 2026-11-06T20:09:47.272Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-N-RUNTIME: `apps/client-cocos/assets/resources/dragonbones/the-tu-sprites/thetu_N_*; apps/client-cocos/assets/resources/dragonbones/the-tu-sprites.meta` | THES-N-SHEET; @vgtd/sprite PMA atlas and DragonBones display-swap exporter, Cocos Creator metadata | 2026-11-06T20:09:47.272Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |
| THES-N-REF: `assets-src/placeholder/the-tu-continuous-v1/reference/N.master4x.png` | Preserved The tu master from PR #113; see upstream concept/master provenance in the same license log | 2026-11-06T20:09:47.272Z | image_gen.imagegen / model undisclosed by tool (inherited); codex-cli 0.166.0; @vgtd/sprite deterministic processing; Cocos Creator 3.8.8 | Người dùng (interim art owner) | AI-generated, placeholder, needs hand-polish + license review before release | no |

### attack.attempt1.generation.json

```json

{
  "clip": "attack",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:37:36 UTC",
  "prompt": "Production ATTACK NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera; image2 layoutguide. FOUR equalSQUARE columns TWO rows,8completefullbodyframes rowmajor,aspect2:1. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame RIGHTPUNCH directly AWAY/UP.1guard;2rightfistload;3windback;4extend;5impact;6retract;7recover;8exactguard. Anatomicalright=screenRIGHT, rightarmforeshortensAWAYtowardUP, nottowardsviewer. Slighttorsolean, noheadturn, bootsplanted. Backcloudemblemremainsvisible. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. All8figures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/attack.template.png"
  ],
  "selectedOutput": "sheets/attack.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:39:07 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-c25678cd-facd-4d2a-bd71-022134dedbb2.png",
  "originalBackup": "raw/originals/attack.attempt1.png"
}

```

### attack_2.attempt1.generation.json

```json

{
  "clip": "attack_2",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:37:36 UTC",
  "prompt": "Production ATTACK_2 NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera; image2 layoutguide. FOUR equalSQUARE columns TWO rows,8completefullbodyframes rowmajor,aspect2:1. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame LEFTPALM strike directly AWAY/UP.1guard;2leftdrawback;3load;4extendleftopenpalmAWAY;5impact;6retract;7recover;8exactguard. Anatomicalleft=screenLEFT. StrikeinFRONTofbodybehindtorsofromthisview, elbow/upperarmvisible, doNOTturnsideways toshowface. Rightgauntletguardsribs. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. All8figures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/attack_2.template.png"
  ],
  "selectedOutput": "sheets/attack_2.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:39:08 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-140599f0-b068-440a-9e2d-24a9b5f767e0.png",
  "originalBackup": "raw/originals/attack_2.attempt1.png"
}

```

### attack_3.attempt1.generation.json

```json

{
  "clip": "attack_3",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:37:36 UTC",
  "prompt": "Production ATTACK_3 NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera; image2 layoutguide. FOUR equalSQUARE columns TWO rows,8completefullbodyframes rowmajor,aspect2:1. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame TWO-GAUNTLET GROUNDSLAM.1guard;2bothfistsatshoulders;3bothbronze fists ABOVE bun;4torsofoldsforward/kneesbend;5bothgauntlets smashground inFRONTofbodyAWAYfromcamera;6holdlow;7rise;8exactguard. Groundimpacthiddenpartlybybodyfromrearview; keepfulllimbsize andnaturalclothingfolds. NoVFX, no camera turn. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. All8figures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/attack_3.template.png"
  ],
  "selectedOutput": "sheets/attack_3.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:39:07 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-2650798d-d453-4945-af10-02d74f59f7fa.png",
  "originalBackup": "raw/originals/attack_3.attempt1.png"
}

```

### cast.attempt1.generation.json

```json

{
  "clip": "cast",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:37:36 UTC",
  "prompt": "Production CAST NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera; image2 layoutguide. FOUR equalSQUARE columns TWO rows,8completefullbodyframes rowmajor,aspect2:1. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame standingEARTHPALM CAST.1guard;2handsgatherabdomen;3risechest;4gather;5bothpalms pushAWAY/UP infrontofbody;6hold;7retract;8exactguard. HandsmostlyhiddenbytorsofromstraightBACK; upperarms/elbowmotionreadable. No turningtowardcamera justtoshowpalms. Stable212unitstature. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. All8figures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/cast.template.png"
  ],
  "selectedOutput": "sheets/cast.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:39:08 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-fb1ac7a2-0793-4582-84fc-b4cd3bef284a.png",
  "originalBackup": "raw/originals/cast.attempt1.png"
}

```

### channel.attempt1.generation.json

```json

{
  "clip": "channel",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:42:02 UTC",
  "prompt": "Production CHANNEL NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera, image2 layoutguide. EXACT 4 equalSQUARE columns 2 rows,8fullbodyframes rowmajor,aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame seamless standingCHANNEL. Gauntletsheld atlowerchest AWAYfromcamera, handsmostlyhiddenbehindtorso. Backcloudemblemvisible.1neutral;2inhale;3inhalepeak;4relax;5neutral;6exhale;7relax;8exactfirst. Feetplanted, stable212unitstature. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/channel.template.png"
  ],
  "selectedOutput": "sheets/channel.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:43:27 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-8dc77796-6182-4bfa-952d-983b71aec4ef.png",
  "originalBackup": "raw/originals/channel.attempt1.png"
}

```

### dash.attempt1.generation.json

```json

{
  "clip": "dash",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:42:02 UTC",
  "prompt": "Production DASH NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera, image2 layoutguide. EXACT 3 equalSQUARE columns 2 rows,6fullbodyframes rowmajor,aspect3:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Six-frameDASH directlyAWAY/UP:1guard;2bendknees/torsoleansAWAY;3launchonelegbehind;4airbornelunge;5landbentknees;6exactguard. Backcamera staysstraightN, noface. Samefulllimbsizes, no shrinking. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/dash.template.png"
  ],
  "selectedOutput": "sheets/dash.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:42:48 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-4d3ed418-abd2-4852-be65-8d8742c1a8e9.png",
  "originalBackup": "raw/originals/dash.attempt1.png"
}

```

### die.attempt1.generation.json

```json

{
  "clip": "die",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:45:25 UTC",
  "prompt": "Production DIE NORTH straightBACK sprite sheet. Image1exactmasteridentity/camera; image2layout/poseguide. EXACT 4 equalSQUARE columns 2 rows,8completefullbodyframes rowmajor,aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frameDIE.1standingguard;2shouldersslump;3kneel;4bothkneesground;5leanontoleftarm;6collapseSIDEWAYS;7lyingonrightside;8exactsamefinalpose. KeepBACK camera, facehidden, full-sizedhead/limbs/torso evenlying. No blood, no miniaturecorpse. Entirelyingbodyfitscell. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/die.template.png"
  ],
  "selectedOutput": "sheets/die.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:46:55 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-357712c2-8c51-4bcb-8043-edec7900e209.png",
  "originalBackup": "raw/originals/die.attempt1.png"
}

```

### emote.attempt1.generation.json

```json

{
  "clip": "emote",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:45:25 UTC",
  "prompt": "EDIT target image1 NORTH straightBACK sprite sheet. Image1acceptedidle EDIT TARGET; image2masterreference. EXACT 4 equalSQUARE columns 2 rows,8completefullbodyframes rowmajor,aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  EDIT image1 acceptedIDLEsheet, image2 masteridentity only. KeepEXACT image1 canvas/grid andeachfigureheight/headbunposition/torso/legs/boots. ChangeONLYarms/gauntlets:1unchangedidle;2handsrise;3rightfistmeetsleftpalmatthechestAWAYfromcamera;4hold;5tinypolitechinnodWITHOUTmovingbun;6returnchin;7handslower;8unchangedidle. HandsmostlyhiddenbehindtorsofromstraightBACK, upperarm/elbowmotionvisible. DO NOT turncamera/head toshowface. NO zoom/rescale/elongationofbody. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "sheets/idle.png",
    "../../the-tu-continuous-v1/reference/N.master4x.png"
  ],
  "selectedOutput": "sheets/emote.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:46:55 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-cf498b5d-2d60-4810-a7bd-e5946e0ffa9d.png",
  "originalBackup": "raw/originals/emote.attempt1.png"
}

```

### hit.attempt1.generation.json

```json

{
  "clip": "hit",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:42:02 UTC",
  "prompt": "Production HIT NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera, image2 layoutguide. EXACT 4 equalSQUARE columns 1 rows,4fullbodyframes rowmajor,aspect4:1. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Four-frameHIT:1guard;2shouldersrecoilbacktowardcamera andkneesflexshallowly;3recover;4exactguard. Samehead/torso/limbsizes, straightBACK, noheadturn or impacteffects. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/hit.template.png"
  ],
  "selectedOutput": "sheets/hit.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:43:27 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-a1640401-a94b-45e5-be3f-3ef2793202a0.png",
  "originalBackup": "raw/originals/hit.attempt1.png"
}

```

### idle.attempt1.generation.json

```json

{
  "clip": "idle",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:32:23 UTC",
  "prompt": "Production frame-by-frame IDLE NORTH sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 exactN master/style, image2 exactlayout/leading-legghostguide. EXACT 4 equalSQUARE columns 2 rows, 8 completefullbodyframes rowmajor, aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking. Eight-frame seamless IDLE. Bothbootsplanted, armsrelaxedatsides. Tinybreathing:1neutral;2inhale;3inhalepeak;4relax;5neutral;6exhale;7relax;8exactfirst. Standingheight212units. Pure flatopaque#FF00FF background. Removeallgrid/borders/ghosts/dots/ticks/text/labels. No floor/shadows/blur/effects/scenery/afterimages. Onewholefigurepercell, no cropping or overlappingcells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/idle.template.png"
  ],
  "selectedOutput": "sheets/idle.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:33:09 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-d27667f1-08d4-4a30-8559-080fe0496c98.png",
  "originalBackup": "raw/originals/idle.attempt1.png"
}

```

### meditate.attempt1.generation.json

```json

{
  "clip": "meditate",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:45:25 UTC",
  "prompt": "Production MEDITATE NORTH straightBACK sprite sheet. Image1exactmasteridentity/camera; image2layout/poseguide. EXACT 4 equalSQUARE columns 2 rows,8completefullbodyframes rowmajor,aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  SEATED CROSS-LEGGED meditation. Standingmaster212units; seatedfigureonly148units, buny84, seatedbasey232. KeepEXACTmasterhead40..42units/torso/gauntlet/limbanatomicalsizes. Do NOT enlarge seatedbody/head tofillstandingheight. LargeEMPTYmagentaabovehead. StraightBACK, nofacevisible, cloudemblem prominent, full-sizelegsfoldcrosslegged, gauntletsonknees. Eightframesgentlebreathing,lastsamefirst. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/meditate.template.png"
  ],
  "selectedOutput": "sheets/meditate.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:46:55 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-89d1ef21-2ef1-4611-a0d2-2054efaf4f13.png",
  "originalBackup": "raw/originals/meditate.attempt1.png"
}

```

### run.attempt1.generation.json

```json

{
  "clip": "run",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:32:23 UTC",
  "prompt": "Production frame-by-frame RUN NORTH sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 exactN master/style, image2 exactlayout/leading-legghostguide. EXACT 6 equalSQUARE columns 2 rows, 12 completefullbodyframes rowmajor, aspect6:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking. Twelve-frame RUN in place AWAY/UP, straightBACK camera. RscreenRIGHT/LscreenLEFT.1Rcontact;2Rload;3Rmidstance/Lpassing;4Rpush/Lswing;5Rlatepush;6Lprecontact;7Lcontact;8Lload;9Lmidstance/Rpassing;10Lpush/Rswing;11Llatepush;12Rprecontact. Strong alternatinglegreversal and heelsolevisibility, heavygauntlets swingoppositelegs. Keeponeboot DOWN near groundy232 evenbetweencontacts, no deepjump/tuckedflight, legsremainfulllength. Upperbodyupright, shallowkneeflex, stableheight212 (allowed206..218). Matchleadingghosts withoutturningcamera. Pure flatopaque#FF00FF background. Removeallgrid/borders/ghosts/dots/ticks/text/labels. No floor/shadows/blur/effects/scenery/afterimages. Onewholefigurepercell, no cropping or overlappingcells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/run.template.png"
  ],
  "selectedOutput": "sheets/run.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:33:10 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-cecf630f-651b-4eea-9b35-b975e0e3e6d9.png",
  "originalBackup": "raw/originals/run.attempt1.png"
}

```

### run.attempt2.generation.json

```json

{
  "clip": "run",
  "dir": "N",
  "attempt": 2,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:36:07 UTC",
  "prompt": "EDIT image1: NORTH straightBACK twelve-frame RUN sheet, SIX equal square columns TWO rows. Image2 masteridentity only. CHANGE ONLY 0-based cells4,6,7,8,10,11 (row1col5; row2cols1,2,3,5,6). Other6 cells remain exactly unchanged. These six figures are a little too tall. REDRAW their leg articulation with a VERY SHALLOW knee flex to lower shoulders/head by about6..8units per256cell while keeping boots on originalgroundline. Preserve exact same head/torso/arm/leg anatomical sizes and identity. NO zoom, rescale, squashing, cropping or changing the canvas. Keep their current leading/swing legs and opposite arm motion, only softly flex the supporting knee to reduce upright boundingheight to210..214units (allowed206..218). Do not deeply crouch or tuck feet. Natural ivory trouser folds and dark boots. Keep flat straightBACK NORTH camera facingAWAY UP, nofacevisible, backcloudbronzeemblem, mountainblue shorttabard, darkblue sashbandNOfrontknot, darkbun/jadepin, bothbronze blockgauntlets. Sameflat#FF00FF background, no guides/borders/text/shadows/effects. Full12-cellgrid preserved; only listed cells change.",
  "references": [
    "raw/run.attempt1.png",
    "../../the-tu-continuous-v1/reference/N.master4x.png"
  ],
  "selectedOutput": "raw/run.attempt2.edited.png",
  "repairCells": [
    4,
    6,
    7,
    8,
    10,
    11
  ],
  "status": "donor generated; selected cells only pending QA",
  "utcEndObserved": "2026-11-06 19:36:30 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-fd8602f4-b7f6-4f55-b8ed-91ae13565fae.png",
  "originalBackup": "raw/originals/run.attempt2.png"
}

```

### sword_fly.attempt1.generation.json

```json

{
  "clip": "sword_fly",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:42:02 UTC",
  "prompt": "Production SWORD_FLY NORTH straightBACK sprite sheet. Image1 exactmasteridentity/camera, image2 layoutguide. EXACT 4 equalSQUARE columns 2 rows,8fullbodyframes rowmajor,aspect4:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Eight-frame seamless HOVER, no sword/platform.1upright relaxedhover;2rise2units;3rise3;4rise1;5neutral;6lower1;7lower2;8exactfirst. Toesbelowhips, gauntletsrelaxedatsides, bodyanatomy212unitssameasstanding. No effects. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/sword_fly.template.png"
  ],
  "selectedOutput": "sheets/sword_fly.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:43:08 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-e60fd9d8-0560-444e-a090-5c153abcc471.png",
  "originalBackup": "raw/originals/sword_fly.attempt1.png"
}

```

### tribulation.attempt1.generation.json

```json

{
  "clip": "tribulation",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:45:25 UTC",
  "prompt": "Production TRIBULATION NORTH straightBACK sprite sheet. Image1exactmasteridentity/camera; image2layout/poseguide. EXACT 6 equalSQUARE columns 2 rows,12completefullbodyframes rowmajor,aspect6:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking.  Twelve-frameTRIBULATION brace.1guard;2tense;3fistsrise;4forearmscrossinfrontofchestAWAYfromcamera;5kneesbend;6headlowers;7deepbrace;8hold;9rise;10handslower;11guard;12exactfirst. Camera staysstraightBACK, faceinvisible, backcloudmotifvisible. No lightning/effects. Pureflatopaque#FF00FF background, removeALL borders/gridlines/template marks/ticks/text. No shadows/scenery/floor/glow/particles/rocks/afterimages/weapons. Allfigures sameanatomicalscale, entirelyinowncells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/tribulation.template.png"
  ],
  "selectedOutput": "sheets/tribulation.png",
  "status": "selected; awaiting QA",
  "utcEndObserved": "2026-11-06 19:46:55 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-4369ca9a-7cf5-4f9a-b298-54f282e3abff.png",
  "originalBackup": "raw/originals/tribulation.attempt1.png"
}

```

### walk.attempt1.generation.json

```json

{
  "clip": "walk",
  "dir": "N",
  "attempt": 1,
  "tool": "image_gen.imagegen",
  "model": "undisclosed by tool",
  "cli": "codex-cli 0.166.0",
  "utcStart": "2026-11-06 19:32:23 UTC",
  "prompt": "Production frame-by-frame WALK NORTH sprite sheet for Van Gioi Tien Do, The tu A Son Mon Ho Ve. Image1 exactN master/style, image2 exactlayout/leading-legghostguide. EXACT 6 equalSQUARE columns 2 rows, 12 completefullbodyframes rowmajor, aspect6:2. EVERY cell faces NORTH / directly AWAY from viewer toward screenUP. EXACT straight BACK view, slight overhead orthographic isometric camera matching image1; symmetricalback, NO side-profile/NEturn, NO visible eyes/nose/mouth/face. Same compact STOCKY adult male earth tank, broad back/stout full-length legs, short darkbrown hair/topbun/jadehairpin. Ivory sleeves/trousers#E9EEF0, mountain-blue short split tabard#5E8798 with bronze#B58A4A CLOUD EMBLEM acrossupperback and bronze cloud hemtrim. Dark-blue#294451 waist sash BAND ONLY, no frontknot seen; twotails largely hiddenbehindbackpanel. Dark boots. Bothhands wear large bronze stone-block EARTH GAUNTLETS with square meander emblem, ochre#E3C07F highlights/brown#5B4222 shadows. No sword/shield/platform/weapons/extraarmor/longhair. Exact fine ink outlines and restrained2-3tone painterly celshading, NWlight. Same adult headsize/torso/limbs inallframes, natural redrawn clothfolds, no rubber limbs. FRAMING: eachcell256units, bun topy20, boot solesy232, height212, pelvisaxisx127.54. Allframes exactsameanatomicalscale; no zoom/shrinking. Twelve-frame WALK in place walking AWAY/UP, stay straightBACK camera. AnatomicalR=screenRIGHT boot, L=screenLEFT.1Rcontactforwardaway;2Rload;3Rmidstance/Lpassing;4Rpush/Lswing;5Lapproach;6Lprecontact;7Lcontact;8Lload;9Lmidstance/Rpassing;10Lpush/Rswing;11Rapproach;12Rprecontact. Alternate clearlywhichbootextendsawayandwhichheellifts, ratherthanallframesonepose. Followtemplate ghosts, minimalhiptranslation. Stableheight212; oneboot reachesgroundy232 inEVERYframe, shallowkneeflex only. Pure flatopaque#FF00FF background. Removeallgrid/borders/ghosts/dots/ticks/text/labels. No floor/shadows/blur/effects/scenery/afterimages. Onewholefigurepercell, no cropping or overlappingcells.",
  "references": [
    "../../the-tu-continuous-v1/reference/N.master4x.png",
    "templates/walk.template.png"
  ],
  "selectedOutput": "sheets/walk.png",
  "status": "selected; awaiting upright QA",
  "utcEndObserved": "2026-11-06 19:33:11 UTC",
  "originalImageId": "imagegen:01a1ae93-8c12-7102-b948-0a9ecd590073/exec-7471e43c-ffd3-40a1-8846-fc098777c74e.png",
  "originalBackup": "raw/originals/walk.attempt1.png"
}

```

<!-- THE-TU-SPRITES-N:END -->
