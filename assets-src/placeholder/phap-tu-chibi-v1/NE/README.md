# NE full-source compatibility motion

15 smooth-v2 clips /202 frames, natural left-hand fan; exact24Hz clock. D41 full-source compatibility only. Extracted body/weapon/FX runtime sets follow after all5 T1 directions merge.

Locked NE master remains unchanged (SHA256 `64bda58468c608a5f872c0517efb1e0fe9cbdda05d44d8046e56e9b81702cce4`). D53 uses crown(140,16), skull breadth52 and visible right acromion(156,79), vertical63px; left shoulder is hidden by fan/hair/ribbon. Dynamic dash1-8 use approved D56 breadth-only evidence. All required landmarks are measured on aligned256px cells; no projected anatomy or per-frame fitting.

D57 pins run0/1/12 registration to `repair/run.pre-edit.png`, verifies native RGBA outside `repair/run.head-edit-mask.png`, and records source/mask hashes in project.json and the runtime contract. Run1 uses masked AIattempt9 (breadth53/span64), run12 attempt7 (breadth52/span62); unselected attempts remain for provenance.

Official source QA:0 hard,0 new soft,0 regressions,19 accepted open foot findings,220 INFO. Channel right-hand pose and foot polish remain explicitly open in quality-backlog. D54 rerun with D55:20 newly checked PASS,0 FAIL,0 unmeasured;132 D41 exemptions are separate, not passes. `similarity-audit.json` pins inputs. Real Cocos Creator3.8.8 2x capture passed all15 clips with24 midpoint samples each; engine-gate.json pins the five rendered files and exact24Hz clock.

Official D45 guides are reproducible with:

```sh
npm run sprite:layer-template -w @vgtd/sprite -- --project assets-src/placeholder/phap-tu-chibi-v1/NE/project.json --out <fresh-temp-directory>
```

Input project SHA256: `27465405e6d5b05c02cfde1c3395c2f701b952a851d3bb9b5af56b200fd81f2e`. Layer-inputs.json SHA256: `be3f59633ea6cf434cffdd54d28f9b1d9d2832f001e6323254de714680443123`. The manifest pins all source sheets and clip mappings. No derived guide PNGs are committed.

| Guide              | SHA256                                                           |
| ------------------ | ---------------------------------------------------------------- |
| source-0.full.png  | 56ad9b4a3e247d154cea2764a59a6543c79c0b5a720f9f7525d88b7c32567112 |
| source-1.full.png  | b9e6585412f34d06eeddc00d5f56caf7fa096bd175e8df863cb8f4f4248edde3 |
| source-2.full.png  | ae7bedf5d8193443680d4b6a1179015b84c30e3758f9b2c6aeaa2c0e0238119a |
| source-3.full.png  | 9c562c72a3bfe3076741cd595085a21ae660b0b77557da23cc296f0bd2c7f883 |
| source-4.full.png  | ff009db397e810cb9cd8abfc510a9403bfa35fd0f6cd72bdff09110d7364b300 |
| source-5.full.png  | 9f274be761b74ae3a181020315818e3f2e3515aa1f8efe187256cfa48e0a11cc |
| source-6.full.png  | 61bf7467fc56fe107e0e41d3e56895c63744f190a566d05d19f9c33abd11af31 |
| source-7.full.png  | 34db4c46782e1562f4939ffa080d611c82907e19197cb88bc88d440f90f257a0 |
| source-8.full.png  | a108216f8923022eeae2577757860fb40a93f11c237d4e19d92d691caac52a0b |
| source-9.full.png  | 55efb686dd34975989c5d86ceedb46798b25cfd9afa144e7b908bb4454b6c7a4 |
| source-10.full.png | 9dc5cf603e9c8f313622eed8c03334eb9590c27149cf7c14370d0ebb5cff27eb |
| source-11.full.png | 68b367044cf8154c0176762d829c46f214676d79c1c962faa0aad42087a2d06c |
| source-12.full.png | cc3532b250257ddec45c2a3785256b45a78464fd59a90caa2a7c7ab6700fbd81 |
| source-13.full.png | f9949b7a9658d1eb2b04b59375b627f4c6af4457d232c4627dc90d39e52f7f84 |
