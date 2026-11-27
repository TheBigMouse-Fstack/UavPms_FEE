# [FE-REQ-004] Local-Only GIS Migration (PMTiles + Schematic Fallback) & GIS Emergency Alert Cleanup

- **Req ID**: `FE-REQ-004`
- **Phase / Batch**: Đợt 2 FE (chạy song song với BE Đợt 0, **không phụ thuộc `openapi.json` v1.0**)
- **Status**: `confirmed` *(Gate 5 đã khóa ngày 2026-11-27 bởi Human Owner; đã phê duyệt vùng `src/app/features/gis/**` CHỈ trong phạm vi Local-only GIS PMTiles + schematic fallback và dọn `markReadForEmergencyAlert()`)*
- **Owner (BA/PO)**: Control Tower / Frontend Owner
- **Named Approver (Tech/Security)**: Independent PR Review Judge + Human Owner (Security/GIS Sign-off)
- **Data Classification** *(per `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: **`Sensitive`** (tọa độ cột điện, tuyến đường dây, vùng địa lý GIS — tối thiểu Nhạy cảm; tuyệt đối không gửi sang dịch vụ bản đồ/tile/geocoder/analytics bên thứ ba; test chỉ dùng tọa độ synthetic đã scrub)

## 1. Problem & Goal (What & Why)

Theo [docs/MASTER_SYSTEM_SPEC.md](../../docs/MASTER_SYSTEM_SPEC.md) (Mục 1, Mục 5 Luồng 3, Mục 7 Đợt 2 FE), [docs/AI_SECURITY_AND_GOVERNANCE.md](../../docs/AI_SECURITY_AND_GOVERNANCE.md) (Mục 4.1, 4.3) và `.agents/skills/uav-security-gate/SKILL.md`:
1. Hiện còn **9 điểm bản đồ online** rải rác trong FE gọi hoặc fallback sang dịch vụ tile/style/CDN bên ngoài (như OpenStreetMap, Carto, ArcGIS/Esri, Google Maps, Mapbox, Stadia hoặc remote font/sprite/glyph). Điều này vừa vi phạm quy định an toàn thông tin hạ tầng lưới điện, vừa làm hỏng bản đồ khi chạy mạng nội bộ hoặc rút mạng Internet.
2. Sau `FE-REQ-003` (gỡ phân hệ `Emergency Alerts`), vẫn còn 1 điểm gọi cuối cùng `markReadForEmergencyAlert()` nằm trong `src/app/features/gis/pages/gis-monitoring/gis-monitoring.ts:1025` (nên `notifications-store.ts` chưa thể xóa method dead code này vì chưa mở quyền chạm vùng `features/gis/**`).

**Goal**:
- Chuyển **100% (toàn bộ 9 điểm bản đồ online)** về một chuẩn **Local-only GIS** duy nhất dùng **`MapLibre` + `public/maps/evnspc-south-z12.pmtiles` + schematic local fallback** — bảo đảm **0 request ra Internet** (không tile, không style, không glyph, không sprite, không geocoder bên thứ ba), chạy ổn định 100% khi rút mạng Internet.
- Xác thực chặt tọa độ trước khi vẽ marker/tuyến (kiểu số hữu hạn, dải `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`, khác `null`/`NaN`): một bản ghi tọa độ hỏng không làm mất toàn bộ snapshot bản đồ hợp lệ.
- Dọn sạch lời gọi `markReadForEmergencyAlert()` ở `gis-monitoring.ts` và xóa method dead code tương ứng trong `notifications-store.ts` (bảo toàn 100% hiển thị mức ưu tiên `Emergency` | `Normal` của khuyết tật & phiếu bảo trì).

## 2. Scope & Non-Goals

- **In Scope**:
  1. **Khảo sát & Chuẩn hóa lớp cấu hình Local-only GIS dùng chung (`PR-1: FE-REQ-004a`)**:
     - Rà soát chính xác toàn bộ điểm khởi tạo bản đồ / URL tile / style / glyph / sprite / geocoder ngoài Internet trên toàn `src/app/`.
     - Xây dựng hoặc chuẩn hóa 1 cấu hình/builder style **Local-only MapLibre + PMTiles** dùng chung (đặt tại `src/app/shared/` — thuần, không import `features/`), trỏ về asset nội bộ `/maps/evnspc-south-z12.pmtiles` + nền **schematic local fallback** (khi ngoài vùng phủ PMTiles hoặc khi tải PMTiles lỗi — tuyệt đối không fallback sang tile online).
     - Chuẩn hóa hàm validate tọa độ an toàn (finite, `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`) + bộ Vitest unit tests đầy đủ (dùng tọa độ synthetic scrubbed).
     - Chuyển toàn bộ các màn hình bản đồ nằm **ngoài `src/app/features/gis/**`** (như `missions`, `towers`, `pre-mission`, `monitor`, v.v.) sang dùng chuẩn Local-only GIS này.
  2. **Chuyển bản đồ trong `src/app/features/gis/**` & Dọn `markReadForEmergencyAlert()` (`PR-2: FE-REQ-004b`)**:
     - *(Bắt buộc có phê duyệt Human-Approval-Required cho `src/app/features/gis/**` trước khi sửa).*
     - Chuyển toàn bộ các điểm bản đồ online trong `src/app/features/gis/**` sang chuẩn Local-only GIS PMTiles + schematic fallback.
     - Gỡ lời gọi `markReadForEmergencyAlert()` trong `src/app/features/gis/pages/gis-monitoring/gis-monitoring.ts` (và các liên kết `/emergency-alerts` cũ nếu còn sót) → xóa method dead code `markReadForEmergencyAlert()` khỏi `src/app/features/notifications/data-access/notifications-store.ts`.
  3. **Tài liệu & Truy vết**: `specs/FE-REQ-004-local-only-gis-pmtiles/*` và `specs/RTM.md`.
- **Small Batch Split Rule (≤ 350–400 dòng diff/PR)**:
  - **PR-1 (`FE-REQ-004a`)**: Shared Local-only GIS style/PMTiles helper + coordinate validator + full Vitest specs + chuyển các màn hình bản đồ **ngoài `src/app/features/gis/**`** (tách `PR-1a`/`PR-1b` nếu vượt ~350 dòng).
  - **PR-2 (`FE-REQ-004b`)**: Chuyển các điểm bản đồ trong **`src/app/features/gis/**`** + dọn `markReadForEmergencyAlert()` ở `gis-monitoring.ts` & `notifications-store.ts` (tách `PR-2a`/`PR-2b` nếu vượt ~350 dòng).
- **Non-Goals (Explicitly Out of Scope)**:
  - Không nối SignalR `/hubs/telemetry` realtime hay thay đổi hợp đồng telemetry (chờ BE Đợt 2).
  - Không thay đổi hợp đồng REST API của `gis-api.ts` (chờ `openapi.json` v1.0 cuối Đợt 1).
  - Không sửa file nhị phân `public/maps/evnspc-south-z12.pmtiles` hay thêm dịch vụ tile/font/icon CDN bên ngoài.
  - Không chạm `src/app/core/auth/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, `.github/workflows/**`, hay các file WIP unstaged (`maintenance-detail.*`, `standalone-upload.html`, `analyst-review/*`).
  - Không sửa hoặc bỏ nhãn mức độ ưu tiên `Emergency` | `Normal` trên khuyết tật và phiếu bảo trì.

## 3. Local-Only GIS & Coordinate Boundary Contract

1. **Zero External Map Requests**:
   - Cấm tuyệt đối mọi URL chứa hoặc gọi tới: `tile.openstreetmap.org`, `openstreetmap.org`, `cartocdn.com`, `basemaps.cartocdn.com`, `arcgisonline.com`, `arcgis.com`, `maps.googleapis.com`, `googleapis.com/maps`, `api.mapbox.com`, `mapbox.com`, `stadiamaps.com`, `tiles.stadiamaps.com`, `demotiles.maplibre.org`, `protomaps.com` CDN, hoặc bất kỳ remote `glyphs`/`sprite`/`tiles` HTTP(S) ngoài origin ứng dụng.
   - Mọi bản đồ MapLibre dùng `pmtiles://` trỏ tới asset local `/maps/evnspc-south-z12.pmtiles` (đăng ký `pmtiles` protocol an toàn, idempotent không đăng ký trùng gây lỗi khi chuyển trang) và/hoặc local GeoJSON + **schematic local fallback** (canvas/vector lưới tọa độ nội bộ).
2. **Coordinate Safety (`docs/AI_SECURITY_AND_GOVERNANCE.md` Mục 4.3)**:
   - Kiểm tra `Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180` trước khi tạo marker/polyline/bounds.
   - Bản ghi hỏng tọa độ bị lọc bỏ an toàn (không throw exception, không làm mất các cột/đường dây hợp lệ khác, không log tọa độ thật ra console).
3. **Offline Resilience**:
   - Khi ứng dụng bị ngắt hoàn toàn Internet (chặn mọi request ra ngoài `localhost`), mọi màn hình có bản đồ vẫn render bình thường trên nền PMTiles local hoặc schematic fallback với **0 request mạng bên thứ ba** và **0 lỗi uncaught console**.

## 4. Security, Privacy, Readability & NFRs

- [x] Bắt buộc nạp `.agents/skills/uav-security-gate/SKILL.md` và `.agents/skills/readable-code-defense/SKILL.md` trước khi code và khi review.
- [x] `npm run check:policy` pass (`exit 0`, 0 vi phạm online map / secret / PII leak).
- [x] `npm run check:arch` pass (0 vi phạm biên `shared/` ↔ `features/`).
- [x] `npm run lint` đạt **0 errors, 0 warnings** (WCAG 2.2 AA cho mọi điều khiển bản đồ: nút zoom/layer/chuyển schematic có `aria-label`, focusable bằng bàn phím).
- [x] Dữ liệu test 100% synthetic scrubbed (tuyệt đối không dùng tọa độ lưới điện thật hay PII thật).
- [x] Full verification gate: `npm run verify:all` (`check:policy` + `check:arch` + `lint` + `ng test --watch=false` + `build`) xanh 100% sau mỗi PR.
