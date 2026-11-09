# 36. Vạn Bảo Lâu cơ bản (D112)

Tính năng: [docs/10 §7.1](10-mvp-scope.md) P4 "Vạn Bảo Lâu cơ bản" (niêm yết 1 %, thuế bán **cố định 5 %** trong beta, CPI tuần chạy **chế độ bóng**), công thức [docs/07 §7](07-cong-thuc-data-schema.md), sổ cái [docs/26 §2-§5](26-kinh-te-ledger.md), giao thức [docs/24](24-giao-thuc-mang.md). Tài liệu này mô tả phần đã cài trong MVP, các giá trị mặc định chưa có designer duyệt và những gì **chưa** làm.

**Chỉ tiền trong game.** Không có trường tiền thật, giá cửa hàng hay quyền lợi (entitlement) nào trên dây, trong sổ cái hay trong dữ liệu chợ. Giá tính bằng **Linh thạch hạ phẩm** (`LT_HA`, đơn vị tính giá mặc định của docs/26 §2.1); chưa hỗ trợ niêm yết bằng trung / thượng phẩm.

## 1. Luật chơi

| Việc            | Luật                                                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Đăng bán        | Chọn **một ô túi** (đồ chồng: số lượng <= số trong ô; đồ instance như bản vẽ: đúng 1), giá mỗi cái (hạ phẩm, >= 1), thời hạn 12 / 24 / 48 giờ. Chỉ đồ `tradable` và chưa `bound`. Tổng giá (giá x số lượng) <= 4.000.000.000 để vừa u32 trên dây.                                                                   |
| Ký quỹ (escrow) | Món hàng **rời túi ngay trong bước tạo niêm yết** và nằm trong bản ghi niêm yết: một vật phẩm luôn ở đúng một nơi (túi, hoặc niêm yết). Instance giữ nguyên độ bền và affix khi bán / trả lại.                                                                                                                      |
| Phí niêm yết    | `ceil(1 % x tổng giá)`, tối thiểu 1 hạ phẩm, **không hoàn** (kể cả khi hủy / hết hạn). Trừ ví người bán, vào `SYSTEM_SINK_LISTING_FEE` (bị hủy, không chuyển cho ai).                                                                                                                                               |
| Mua             | Mua **nguyên lô** (chưa chia nhỏ số lượng). Giá lấy từ **bản ghi niêm yết**, không từ giá client thấy. Bút toán cân bằng: người mua `-giá`, người bán `+(giá - thuế)`, `SYSTEM_SINK_MARKET_TAX` `+thuế`; `thuế = ceil(5 % x giá)` (làm tròn lên, phần dư vào sink, docs/26 §2.1). Vật phẩm vào túi người mua.       |
| Hủy             | Chỉ chủ niêm yết; món hàng về túi (hoặc kho nhặt đồ nếu túi đầy). Hết chỗ cả hai thì **từ chối, niêm yết giữ nguyên**: không mất gì.                                                                                                                                                                                |
| Hết hạn         | Mỗi ~1 giây `tick` trả hàng về người bán (túi, rồi kho nhặt đồ) và báo `market_notice`. Hàng hết hạn **không mua được** ngay cả trước khi quét. Không có chỗ nào: giữ ở trạng thái `returning` (ẩn khỏi sàn), thử lại khi quét / khi chủ vào game.                                                                  |
| Giới hạn        | Tối đa 10 niêm yết đang bán mỗi tài khoản; không tự mua hàng của mình; 8 niêm yết mỗi trang, tối đa 51 trang.                                                                                                                                                                                                       |
| Duyệt / tìm     | Lọc theo loại vật phẩm, phẩm tối thiểu; sắp xếp giá tăng / giảm, mới đăng, sắp hết hạn; chế độ "Hàng của tôi". Chỉ hiện **tên hiển thị** người bán (đã công khai qua chat), không lộ id tài khoản.                                                                                                                  |
| Chống dò        | Mọi lệnh **lấy token giới hạn tốc độ TRƯỚC khi tra niêm yết** (như whisper #247 và bạn bè D96): ghi 3 lệnh/giây (burst 6), tìm kiếm 2/giây (burst 4) mỗi **tài khoản**. Hủy hàng của người khác trả đúng như hàng không tồn tại (`NoSuchListing`). Mọi lệnh đều có đúng một câu trả lời (kể cả bị giới hạn tốc độ). |

## 2. Tiền: một nguồn công thức

Công thức dạng số thực đã có ở `@vgtd/shared` (`MARKET`, `marketSaleTax`, `listingFee`); D112 thêm **dạng số nguyên** (`formulas/market.ts`) theo đúng quy tắc docs/26 §2.1, vì sổ cái chỉ nhận số nguyên: `listingFeeInt`, `marketTaxInt`, `sellerProceedsInt`, `shadowTaxBps`, `weeklyCpi`, `MARKET_BASKET`, `MARKET_BOARD`. Server và client (xem trước phí / thuế) dùng chung các hàm này; không nơi nào khác viết lại công thức.

**Luật beta (docs/10 §7.1):** thuế áp dụng cho mọi giao dịch là **cố định 5 %** (`MARKET_TAX_BETA_BPS` = sàn của công thức động). CPI tuần chạy ở **chế độ bóng**: được đo và báo cáo, **không bao giờ áp dụng**.

### CPI bóng

Mỗi tuần (đồng hồ chợ = epoch ms, tuần = 7 ngày) `MarketService.tick` tính cho mỗi tuần đã khép lại mà chưa có báo cáo: `CPI_w` = trung bình theo **rổ hàng** (đan đột phá, nguyên liệu, bản vẽ trắng-lục; **định nghĩa rổ là dữ liệu mặc định, cần designer duyệt**) của (giá trung bình có trọng số số lượng tuần này / tuần trước), mỗi món có giao dịch cả hai tuần một phiếu. Báo cáo `ShadowReport {week, cpi | null, appliedBps (500), shadowBps (thuế động sẽ là bao nhiêu), trades, volume}` được lưu trong `market.json` (giữ 52 tuần), đưa vào callback `report` (server ghi log `[vgtd/market] shadow CPI ...`; telemetry #264 có thể đăng ký sau). Không có giao dịch thì không có báo cáo; sau thời gian dừng dài chỉ bù tối đa 8 tuần. Chưa lọc giao dịch bị gắn cờ wash trading (docs/26 §5.3 nói loại trừ; chưa có phát hiện wash trading: OPEN-ITEMS).

## 3. Nguyên tử, cạnh tranh, khởi động lại

- **Trong tiến trình:** mỗi lệnh chạy trong **một lượt đồng bộ** (không `await` giữa kiểm tra và thay đổi): kiểm tra mọi điều kiện trước (niêm yết, tiền, chỗ trong túi), rồi sổ cái, rồi vật phẩm, rồi sổ chợ. Hai lệnh không bao giờ xen kẽ nên mua hai lần cùng niêm yết thì lần hai thấy "không còn"; hủy và mua tranh nhau thì đúng một bên thắng. Sổ cái được ghi **trước** khi vật phẩm di chuyển (ghi sổ có thể bị từ chối, di chuyển đã kiểm tra thì không), nếu bước vật phẩm vẫn lỗi thì bút toán bị đảo bằng một bút toán đối ngược (`reversed` phải luôn bằng 0). Khóa idempotency của sổ cái (`market:list:<id>`, `market:sale:<id>`) dùng id niêm yết không bao giờ tái sử dụng (`nextId` được lưu): một bút toán bán đã áp dụng rồi sẽ **không bao giờ** đưa vật phẩm lần thứ hai (test).
- **Lưu trữ (D92):** `market.json` là tài liệu thứ bảy của `STORE_DOC_NAMES` (nên có trong backup / restore / verify / ảnh chụp sống D99). Toàn bộ sổ được lưu sau mỗi thay đổi (ghi nền D106). Khởi động lại giữ nguyên niêm yết, hàng ký quỹ và báo cáo; tài liệu hỏng / phiên bản mới hơn thì **từ chối khởi động** thay vì bắt đầu với chợ rỗng đè lên hàng đang bán.
- **Qua một lần chết tiến trình (crash):** sổ chợ, sổ cái và túi đồ là **ba tài liệu riêng**, mỗi cái ghi nguyên tử nhưng không cùng lúc. Móc `durable(label)` của `MarketService` được gọi ngay sau mỗi thay đổi của sổ chợ: đó là chỗ nhật ký giao dịch (TxJournal, D102 / #257) làm cho ba tài liệu thành **một đơn vị bền vững**. Khi #257 vào, `server.ts` truyền `durable: (label) => journal.commit(label, [market.file, inventories.file, ledger.file])` (và `DocFile` ghi nền D106 phải theo đúng thứ tự "hoàn tất giao dịch dở trước mọi lần ghi sau"). **Cho tới đó, một crash giữa hai lần ghi tài liệu có thể làm mất hoặc nhân đôi giá trị** (OPEN-ITEMS). Test hiện có chỉ mô phỏng "chết" ở ranh giới giữa các lệnh (dựng lại mọi thứ từ dữ liệu đã lưu sau từng lệnh) và kiểm tra bảo toàn.

## 4. Giao thức (cold family)

Id 50-54 là khối docs/24 đã dành cho chợ; thêm 55-56. Không có PR mở nào dùng 50-56. Thêm id là cộng thêm: không đổi `PROTOCOL_VERSION`.

| Id  | Tên              | Hướng | Thân (big-endian cố định)                                                                                                                                                         |
| --- | ---------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 50  | `market_search`  | C→S   | `clientMsgId u16, view u8 (0 duyệt, 1 của tôi), defId u8 (0 = mọi loại), minQuality u8, sort u8 (0 giá tăng, 1 giá giảm, 2 mới, 3 sắp hết hạn), page u8`                          |
| 51  | `market_results` | S→C   | `clientMsgId u16, view u8, page u8, total u16, n u8 (<= 8), n x {listingId u32, defId u8, quality u8, qty u16, unitPrice u32, seller (u8 len + utf-8), minutesLeft u16, mine u8}` |
| 52  | `market_list`    | C→S   | `clientMsgId u16, slot u8, qty u16, unitPrice u32, durationH u8`                                                                                                                  |
| 53  | `market_buy`     | C→S   | `clientMsgId u16, listingId u32`                                                                                                                                                  |
| 54  | `market_result`  | S→C   | `clientMsgId u16, op u8 (1 đăng, 2 mua, 3 hủy, 4 tìm bị từ chối), reason u8, listingId u32, amount u32 (phí / giá đã trả), tax u32`                                               |
| 55  | `market_cancel`  | C→S   | `clientMsgId u16, listingId u32`                                                                                                                                                  |
| 56  | `market_notice`  | S→C   | `kind u8 (1 đã bán, 2 hết hạn), listingId u32, defId u8, quality u8, qty u16, amount u32` (đã bán: số tiền người bán nhận sau thuế)                                               |

Lý do (`MarketReason`): 0 xong, 1 giới hạn tốc độ, 2 chưa sẵn sàng, 3 yêu cầu sai, 4 không có niêm yết (cũng là "không phải của bạn"), 5 ô túi không bán được, 6 quá số niêm yết, 7 không đủ hạ phẩm, 8 túi hết chỗ, 9 tự mua.

Khác docs/24 (đề xuất cũ): không có `requestId` UUID (lệnh dựa trên trạng thái nên tự idempotent: gửi hai lần thì lần hai không còn gì để làm); không có `currency` (chỉ hạ phẩm); không có `qty` ở `market_buy` (mua nguyên lô). Ghi nhận trong OPEN-ITEMS.

## 5. Client

`MarketModel` (client-core, kiểm thử bằng đơn vị): lọc / sắp xếp / trang, chỉ nhận trang trả lời của **lần tìm mới nhất**, xem trước phí và thuế bằng hàm dùng chung, kiểm tra biểu mẫu tại chỗ (server vẫn kiểm lại), mọi từ chối bằng tiếng Việt. `NetClient.sendMarket` + `net.marketEvents` (object hook riêng, không bị `attachCombat` thay). Panel Cocos `MarketPanel.ts` (DOM, phím **V**): ba tab Mua / Hàng của tôi / Bán, chỉ `textContent` (tên người bán là dữ liệu của người khác), số tiền thật luôn lấy từ kết quả server.

## 6. Kiểm thử

- `packages/shared/test/market.test.ts`: làm tròn, ví dụ docs/26 §2.3, CPI.
- `packages/protocol/tests/market.test.ts`: vòng đi-về chuẩn hóa, id, byte vàng, kiểm tra trường, cắt cụt, fuzz.
- `apps/server/tests/market.test.ts` (29 test): đăng / tìm / mua / hủy / hết hạn, giới hạn, chống dò, **mua đồng thời, hủy so với mua (cả hai thứ tự), mua lại cùng bút toán, mua hai lần, khởi động lại giữa chừng, "crash" sau từng lệnh, móc `durable` lỗi**, CPI bóng, và **fuzz bảo toàn có seed** (hàng trăm bước ngẫu nhiên đăng / mua / hủy / hết hạn / khởi động lại: không vật phẩm nào xuất hiện hay biến mất, không Linh thạch nào được tạo ra, sổ cái cân).
- `apps/server/tests/market-netclient.test.ts`: máy chủ thật + gateway + `NetClient` + `MarketModel`, gồm khởi động lại trên kho tệp D92 giữa lúc đang bán. Test này bắt được lỗi ví người bán không được đẩy `inv_state` sau khi bán (sửa bằng `InventoryService.refresh`).
- `market-persistence.test.ts` (vòng đi-về, từ chối tài liệu hỏng, có trong danh sách backup), `backup.test.ts` (restore drill gồm `market.json`), `packages/client-core/tests/market.test.ts`.

## 7. Chưa làm / mở

Xem OPEN-ITEMS "Vạn Bảo Lâu": bền vững qua crash cần TxJournal (#257); mua một phần; niêm yết bằng trung / thượng phẩm; cửa sổ giá `P_ref/10 .. P_ref x 10` (Q3, chưa có giá tham chiếu); định nghĩa rổ CPI và phát hiện wash trading; thư (`mail`) cho hàng hết hạn khi không còn chỗ; giá trị mặc định (10 niêm yết / tài khoản, thời hạn 12 / 24 / 48 giờ, giới hạn tốc độ) **cần game designer duyệt**; chưa có smoke trình duyệt cho panel (cần dựng Cocos lại).
