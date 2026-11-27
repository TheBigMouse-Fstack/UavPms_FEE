# [FE-REQ-003] Agreed Acceptance Test List (Gate 5)

> **Gate 5 Rule**: Khóa danh sách kiểm thử này **TRƯỚC KHI** Coding Agent chỉnh sửa `src/`. Mọi tiêu chí dưới đây phải được xác minh bằng kiểm tra định tuyến/menu, Vitest unit test, grep tham chiếu chết và `npm run verify:all`.

- **Approved By (QA/PO)**: Human Owner + Control Tower *(Phương án 2A cho PR-3 Active Learning)*
- **Approved Date**: `2026-11-27`

## 1. Happy Path & Core Behaviors (Gherkin)

```gherkin
Feature: Decommission Removed Modules (Alerts, Drone Handover & Active Learning)

  Scenario: Navigation and routes no longer expose Emergency Alerts or Drone Handover
    Given an authenticated user with any of the 5 standard roles (SystemAdmin, Manager, Inspector, Analyst, Technician)
    When the application shell and navigation menu render
    Then no menu item, widget, or quick link for "Emergency Alerts" or "Drone Handover" is displayed
    And navigating directly to legacy routes for Alerts or Drone Handover does not load removed modules or throw uncaught errors

  Scenario: Drone lifecycle and Mission completion remain intact without manual handover
    Given a Manager or Inspector uses Drone Management and Mission pages
    When Drone and Mission views initialize
    Then Drone asset CRUD, Flight Controller binding, and Technical Inspection continue working normally
    And no manual drone handover / return action button or API call exists

  Scenario: Analyst Review hides Active Learning while preserving core defect review
    Given an Analyst opens the AI Detection / Anomaly Review workflow
    When viewing pending anomalies or reviewing a detection
    Then Approve / Reject review actions and Emergency vs Normal priority badges remain fully functional
    And no Active Learning label-editor trigger, retraining button, or Active Learning API request is exposed
```

## 2. `drone-handover` Removal (`PR-1: FE-REQ-003a`)

- [x] Không còn route, mục sidebar/menu, dialog, nút bấm hoặc API service nào thuộc `drone-handover` trong `src/app/`.
- [x] Không có lời gọi HTTP nào tới endpoint `drone-handover` từ bất kỳ component/service nào còn lại.
- [x] Màn hình quản lý Drone (`drone-management`), danh sách/chi tiết Mission (`missions`) và toàn bộ test liên quan (`drone-management.spec.ts`, `missions-api.spec.ts`, `mission-list.spec.ts`, ...) pass 100%. *(PR-1 đạt `APPROVE_FOR_HUMAN_REVIEW` từ Independent Judge, 5 files / 31L; ghi chú dọn stub `/drone-handover` ở `all-four-main-flows.spec.ts` khi cập nhật E2E.)*

## 3. `Emergency Alerts` Removal (`PR-2: FE-REQ-003b`)

- [x] Không còn route, mục sidebar/menu, panel/widget (`analyst-home`, `tower-detail`, `mission-detail`, `standalone-upload`, `analyst-review` callers) hoặc API client (`src/app/features/emergency-alerts/`, `emergency-alerts-api.ts`) thuộc phân hệ `Emergency Alerts` riêng biệt trong `src/app/`. *(Ghi chú: `ActiveAlertsPanel` & `PersonalAlertsCard` đọc `/monitor/alerts` + `Notifications` nên được bảo toàn; giữ `markReadForEmergencyAlert()` trong `notifications-store.ts` do `gis-monitoring.ts:1025` đang gọi, xử lý ở Đợt 2 `FE-REQ-004`.)*
- [x] Không còn lời gọi HTTP nào tới `/api/v1/alerts*` (hoặc Vision Edge Webhook / Alert Escalation) trong `src/app/`.
- [x] **Bảo toàn đúng nghiệp vụ `Emergency` | `Normal`**:
  - Phân loại mức độ `Emergency` | `Normal` trên `DetectedAnomalies` và `MaintenanceTickets` (gồm `isEmergencyClass`, badge khẩn cấp, bộ lọc khuyết tật/phiếu bảo trì) vẫn hoạt động và pass 100% unit test hiện có.
  - Hệ thống thông báo tổng hợp (`Notifications`, `notifications-api.ts`, `notifications-store.ts`, `notifications-realtime.ts`) vẫn hoạt động và pass 100% unit test hiện có.
- [x] Nếu phát hiện điểm nối trong `src/app/features/gis/**` hoặc `src/app/core/auth/**`: đã dừng báo cáo và nhận phê duyệt tường minh từ Human Owner trước khi chỉnh sửa *(duyệt tối thiểu 3 file `core/auth/{roles,route-access,route-access.spec}.ts`; giữ nguyên `features/gis/**` theo Phương án A — PR-2a `89f7ab3` & PR-2b đạt `APPROVE_FOR_HUMAN_REVIEW` từ Independent Judge)*.

## 4. `Active Learning` Hiding (`PR-3: FE-REQ-003c`)

- [x] Toàn bộ nút bấm, tab, modal trigger và route của `Active Learning` (chỉnh sửa bbox gửi train lại AI) bị ẩn hoàn toàn khỏi UI vận hành của mọi role (kể cả `Analyst` và `SystemAdmin`).
- [x] Không có request API Active Learning nào được phát đi khi người dùng thao tác trên luồng `Analyst Review` (xem danh sách, xem chi tiết bbox, `Approve` / `Reject`, gõ trực tiếp `/ai-review?status=Labeling`).
- [x] Cách xử lý các file WIP unstaged trong `src/app/features/analyst-review/*` tuân thủ đúng quyết định đã được Human Owner phê duyệt (Phương án 2A — giữ an toàn mã nền nghiên cứu & WIP, `active-learning.config.spec.ts` khóa mặc định `enabled: false`).

## 5. Architecture, Policy, Accessibility & Verification Gates

- [x] `npm run check:policy` pass (0 violations).
- [x] `npm run check:arch` pass (0 violations, không còn import mồ côi tới file đã xóa; legacy cross-feature imports giảm từ 55 → 41).
- [x] `npm run lint` pass với **0 errors, 0 warnings** (không thêm `eslint-disable`).
- [x] `npx ng test --watch=false` pass 100% *(59/59 spec files, 383/383 tests PASS)*.
- [x] `npm run build` pass với 0 lỗi TypeScript / Angular template / bundle (dung lượng bundle giảm sau khi xóa -2.700 dòng dead code).
- [x] Mỗi PR tuân thủ Small Batch (`PR-1` `f5629ee` → `PR-2a` `89f7ab3` → `PR-2b1` `18de22d` → `PR-2b2` `19e3864` → `PR-3` `db8ad10`), kèm **"Tóm tắt luồng để bảo vệ code"** và đã đạt **FE-Review Judge (`APPROVE_FOR_HUMAN_REVIEW`)** *(chờ CI verify trên snapshot PR sạch khi merge)*.
