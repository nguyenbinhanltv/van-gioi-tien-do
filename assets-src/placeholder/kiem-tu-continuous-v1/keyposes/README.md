# Kiem tu key-pose references - E run draft

Eight individually generated run references use the filenames and landmark schema in
`docs/art/rig-keypose.md`. This cohort is **not accepted animation**: corrected first-fit
silhouette IoU is 0.604-0.710 (target at least 0.85), with two planted-foot slide errors.
The separate ivory-art/hem integration passes its pre-key-pose mechanical gate.

- `E/*.png`: 256x256 straight-alpha references, shared root `(128, 232)`.
- `E/*.landmarks.json`: @2x, x right/y down. L is far, R is near.
- `E/4x/`: uniformly registered 512x512 images before area downsampling.
- `E/raw/`: selected original tool outputs and exact prompt/tool/model/CLI/UTC records.
- `E/guides/`: manually authored short-stride guides supplied to image generation.

Registration uses one uniform scale and translation per image; no limb/image warping.
Wrists, hand locations, boot toe tips, head/neck and robe hem points were visually
annotated using a coordinate grid. Hidden shoulders, elbows, pelvis/chest, hips and
knees are explicitly `_inferred`; ankles covered by boots are inferred too. These
estimates are not measured anatomy. Boot toe pixels remain the observed anchors;
inferred ankle pivots use the master's foot lengths. Hidden elbows/knees use constrained
two-segment estimates; arm/thigh/shin segment lengths remain within 5% of the master.

The fitter's `pelvis` is the hip-bone origin (rest E `(118, 130)`), not the average of
the hip sockets `(118, 139)` / `(126, 139)`. `chest` is the spine junction (rest `(118, 94)`).
An initial lower-chest/hip-socket interpretation was corrected before the recorded fit.

Earlier wide-stride outputs, a cloudy matte output and a wrong-support-foot output
were rejected. Their full prompts and processing history are recorded in
`docs/ASSET-LICENSES.md`; they are not active references. The current cohort still
needs arm/root fitting, skirt-following, foot planting, independent IoU and Cocos
validation with worker 15 before additional pose sets or directions are accepted.
