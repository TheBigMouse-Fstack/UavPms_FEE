# [FE-REQ-004] Agreed Acceptance Test List (Gate 5)

> **Gate 5 Rule**: Khóa danh sách kiểm thử này **TRƯỚC KHI** Coding Agent chỉnh sửa `src/` (và bắt buộc có phê duyệt riêng của Human Owner cho vùng `src/app/features/gis/**` trước khi thực hiện PR-2).

- **Approved By (QA/PO & Security)**: Human Owner + Control Tower *(đã duyệt riêng vùng `src/app/features/gis/**` theo phạm vi spec)*
- **Approved Date**: `2026-11-27`

## 1. Happy Path & Core Behaviors (Gherkin)

```gherkin
Feature: Local-Only GIS (PMTiles + Schematic Fallback) & GIS Cleanup

  Scenario: Map views load solely from local PMTiles asset with zero third-party network requests
    Given the user has a valid session and opens any map-enabled view (GIS Monitoring, Mission Create/Detail, Tower Management, Pre-Mission)
    When the map initializes
    Then the map loads its style and vector tiles solely from local asset "/maps/evnspc-south-z12.pmtiles" (or local GeoJSON / schematic)
    And zero network requests are made to Google Maps, OpenStreetMap, Carto, ArcGIS, Mapbox, Stadia, or any external tile/glyph/sprite CDN

  Scenario: Fallback to local schematic view works cleanly when PMTiles is unavailable or out of bounds
    Given coordinates fall outside PMTiles coverage or PMTiles loading fails
    When the map renders
    Then the UI gracefully switches to or displays the local schematic background without throwing uncaught errors
    And it NEVER falls back to any online map tile URL

  Scenario: Malformed coordinate records are safely skipped without breaking valid map snapshots
    Given an API snapshot contains 2 valid synthetic towers and 1 corrupted tower (NaN / out-of-range latitude 999 / null)
    When the map normalizes and renders markers
    Then the 2 valid markers render normally
    And the corrupted record is safely ignored without crashing the view or logging raw coordinates
```

## 2. Zero External Map / CDN Audit (`PR-1` & `PR-2`)

- [ ] Grep toàn bộ `src/` (gồm `.ts`, `.html`, `.scss`, `.json`) xác nhận **0 tham chiếu** tới:
  - `openstreetmap.org`, `cartocdn.com`, `arcgisonline.com`, `arcgis.com`, `maps.googleapis.com`, `mapbox.com`, `stadiamaps.com`, `demotiles.maplibre.org`, `esrigis`, `tile.`, hoặc bất kỳ URL `http://`/`https://` remote nào dùng làm map tile/style/glyph/sprite/geocoder.
- [ ] `npm run check:policy` pass với **exit code 0** (0 violations).
- [ ] Asset nội bộ `/maps/evnspc-south-z12.pmtiles` được trỏ nhất quán qua lớp cấu hình Local-only GIS dùng chung (đăng ký `pmtiles` protocol idempotent, không lỗi khi khởi tạo/hủy nhiều map liên tiếp).

## 3. Coordinate Validation & Schematic Fallback Unit Tests (`PR-1: FE-REQ-004a`)

- [x] Validator tọa độ chấp nhận tọa độ synthetic hợp lệ (gồm biên `0`, số âm hợp lệ trong `lat ∈ [-90, 90]`, `lng ∈ [-180, 180]`).
- [x] Validator tọa độ từ chối an toàn: `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, `lat > 90`, `lat < -90`, `lng > 180`, `lng < -180`, chuỗi rác.
- [x] Tập dữ liệu hỗn hợp (bản ghi hợp lệ + bản ghi tọa độ hỏng) vẫn giữ nguyên tất cả bản ghi hợp lệ mà không throw exception.
- [x] Builder style Local-only GIS trả về cấu trúc MapLibre style chỉ chứa nguồn nội bộ (`pmtiles://` / local GeoJSON / schematic background), **không chứa bất kỳ URL `http(s)://` bên ngoài nào** — được khóa cứng bằng Vitest unit test *(kèm tường lửa runtime `isLocalOnlyMapUrl` / `transformLocalMapRequest` chặn `\`, cross-origin `blob:`, `pmtiles://data:`, mọi domain ngoài)*.
- [x] Chế độ schematic local fallback được kiểm thử unit test xác nhận render được khi tắt/lỗi PMTiles (bỏ qua `AbortError`) và không kích hoạt URL online fallback. *(PR-1a đạt `APPROVE_FOR_HUMAN_REVIEW` từ Independent Judge.)*

## 4. `src/app/features/gis/**` Migration & `markReadForEmergencyAlert` Cleanup (`PR-2: FE-REQ-004b`)

- [x] Chỉ thực hiện sau khi Human Owner phê duyệt tường minh phạm vi `src/app/features/gis/**`.
- [x] Toàn bộ điểm bản đồ online trong `src/app/features/gis/**` đã chuyển sang Local-only GIS (`evnspc-south-z12.pmtiles` + schematic fallback, commit `efbf11f`).
- [x] Gỡ sạch lời gọi `markReadForEmergencyAlert()` ở `src/app/features/gis/pages/gis-monitoring/gis-monitoring.ts` (và đường dẫn `/emergency-alerts` cũ nếu còn sót) và xóa method dead code `markReadForEmergencyAlert()` trong `src/app/features/notifications/data-access/notifications-store.ts`.
- [x] Grep toàn `src/app/` xác nhận **0 tham chiếu** còn sót tới `markReadForEmergencyAlert`.
- [x] Bảo toàn 100% hiển thị mức độ ưu tiên `Emergency` | `Normal` của khuyết tật/phiếu bảo trì và toàn bộ unit test GIS (`gis-monitoring.spec.ts`, 60/60 files / 390/390 tests PASS). *(Demo Triage: `PR-1b2` `assessment-create`/`assessment-workspace` và Independent Judge review cho `PR-1b1`/`PR-2` hoãn sang ngay sau Demo.)*

## 5. Offline Verification, Accessibility & Gates

- [ ] `npm run check:policy` pass (0 violations).
- [ ] `npm run check:arch` pass (0 violations; helper bản đồ trong `src/app/shared/` không import từ `features/` hoặc `core/`).
- [ ] `npm run lint` pass với **0 errors, 0 warnings** (WCAG 2.2 AA cho điều khiển bản đồ/schematic).
- [ ] `npx ng test --watch=false` pass 100% (tất cả spec cũ + spec mới cho local GIS builder & coordinate validator).
- [ ] `npm run build` pass với 0 lỗi TypeScript / Angular template.
- [ ] Không chứa tọa độ lưới điện thật, token, email hay PII trong code, test, log.
- [ ] Mỗi PR tuân thủ Small Batch (≤ 350–400 dòng diff/PR), kèm **"Tóm tắt luồng để bảo vệ code"** + mục cần ATTT/Owner xác nhận (theo `uav-security-gate/SKILL.md`), và qua **FE-Review Judge (`APPROVE_FOR_HUMAN_REVIEW`)** trên clean session.
