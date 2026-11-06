# Quality backlog: the-tu

Generated from `quality-backlog.json` (22 accepted soft findings). Hard gates (frames, upright height, similarity, loop seam, export) are never listed. A listed finding passes as a warning while its value is no worse than recorded.

| clip | dir | cell | gate | metric | value | limit | status | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dash | NE | 0 | height | height_excess_px | 1.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| dash | NE | 5 | height | height_excess_px | 1.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| die | NE | 1 | height | height_excess_px | 4.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| hit | NE | 0 | height | height_excess_px | 1.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| hit | NE | 3 | height | height_excess_px | 1.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 1 | footSlide | slide_px_per_frame_R | 6.94 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 3 | footSlide | ghost_offset_px_R | 23.3 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 4 | footSlide | ghost_offset_px_R | 25.3 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 5 | footSlide | ghost_offset_px_R | 34.3 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 7 | footSlide | ghost_offset_px_L | 20.5 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 9 | footSlide | ghost_offset_px_L | 21.2 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| run | NE | 11 | footSlide | ghost_offset_px_L | 24.6 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| sword_fly | NE | 1 | height | height_excess_px | 2.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| sword_fly | NE | 2 | height | height_excess_px | 4.6 | 0 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 2 | footSlide | slide_px_per_frame_R | 6.35 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 4 | footSlide | slide_px_per_frame_R | 5.48 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 5 | footSlide | slide_px_per_frame_R | 16.37 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 6 | footSlide | ghost_offset_px_L | 30.1 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 7 | footSlide | ghost_offset_px_L | 25.7 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 9 | footSlide | slide_px_per_frame_L | 5.38 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 10 | footSlide | slide_px_per_frame_L | 19.45 | 3 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |
| walk | NE | 11 | footSlide | ghost_offset_px_L | 33.4 | 20 | open (18) | First production pass: keep frozen scale and all frames; measured foot/ghost drift or free-pose redraw height remains open for polish. No hard gates accepted. |

<!-- THE-TU-VISUAL-NOTES -->
## Ghi chú quan sát thủ công

Các dòng này bổ sung quan sát hình ảnh; không thay thế verdict QA và không cho phép bỏ qua hard gate.

| Clip | Hướng | Ô (0-based) | Gate | Metric | Value | Limit | Trạng thái | Ghi chú |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run | NE | 10 | footSlide | contact_hold_frames | 2 | 1 | open | First-pass late-cycle hold: cell10 repeats cell9 after three AI calls. All12 frames and frozen scale retained. Restore unique flight/reversal in polish; automated foot/ghost metrics remain separately judged. |
