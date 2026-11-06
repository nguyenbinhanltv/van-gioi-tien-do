# Quality backlog: the-tu

Generated from `quality-backlog.json` (12 accepted soft findings). Hard gates (frames, upright height, similarity, loop seam, export) are never listed. A listed finding passes as a warning while its value is no worse than recorded.

| clip | dir | cell | gate      | metric               | value | limit | status    | note                                                                                                                                    |
| ---- | --- | ---- | --------- | -------------------- | ----- | ----- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| dash | E   | 0    | height    | height_excess_px     | 0.5   | 0     | open (18) | Free dash standing endpoints 210px, only0.5px outside217px master band; small redraw drift, no per-frame scaling.                       |
| dash | E   | 5    | height    | height_excess_px     | 0.5   | 0     | open (18) | Free dash standing endpoints 210px, only0.5px outside217px master band; small redraw drift, no per-frame scaling.                       |
| run  | E   | 1    | footSlide | slide_px_per_frame_R | 13.14 | 3     | open (18) | Owner first-pass policy: measured sole/ghost mismatch and foot slide; explicit flight contacts retained, improve boot trajectory later. |
| run  | E   | 2    | footSlide | ghost_offset_px_R    | 21.9  | 20    | open (18) | Owner first-pass policy: measured sole/ghost mismatch and foot slide; explicit flight contacts retained, improve boot trajectory later. |
| run  | E   | 6    | footSlide | slide_px_per_frame_L | 15.02 | 3     | open (18) | Owner first-pass policy: measured sole/ghost mismatch and foot slide; explicit flight contacts retained, improve boot trajectory later. |
| run  | E   | 7    | footSlide | slide_px_per_frame_L | 6.06  | 3     | open (18) | Owner first-pass policy: measured sole/ghost mismatch and foot slide; explicit flight contacts retained, improve boot trajectory later. |
| walk | E   | 1    | footSlide | slide_px_per_frame_R | 6.5   | 3     | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |
| walk | E   | 2    | footSlide | slide_px_per_frame_R | 16.16 | 3     | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |
| walk | E   | 3    | footSlide | slide_px_per_frame_R | 4.01  | 3     | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |
| walk | E   | 5    | footSlide | slide_px_per_frame_L | 7.45  | 3     | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |
| walk | E   | 6    | footSlide | slide_px_per_frame_L | 26.3  | 3     | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |
| walk | E   | 7    | footSlide | ghost_offset_px_L    | 26.2  | 20    | open (18) | Owner first-pass policy: redraw boot trajectory/leg reversal in polish; preserve master scale and table ground speed.                   |

## Manual art findings (2)

Visual observations; automatic metric pruning never resolves these.

| clip | dir | cells | kind          | severity | reviewer   | art status | note                                                                                                                                                                                                                                                               |
| ---- | --- | ----- | ------------- | -------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| walk | E   | all   | weak_reversal | warn     | art-worker | open       | Đảo vai chân chưa mạnh ở lượt đầu 8 frame. Giữ nguyên ảnh đã được chủ dự án chấp thuận; tăng độ rõ bước chân ở lượt polish. Đây là quan sát art, không phải số đo footSlide và không thay đổi hard gate. Legacy art diagnostic: kind="leg_reversal"; status="open" |
| run  | E   | all   | weak_reversal | warn     | art-worker | open       | Độ rõ đảo chân còn yếu ở một số pha của chu kỳ 10 frame. Giữ đủ frame và scale đã khóa; xử lý silhouette chân ở lượt polish. Số đo chân/ghost nằm riêng trong entries tự động. Legacy art diagnostic: kind="leg_reversal"; status="open"                           |
