# [FE-REQ-005] Agreed Acceptance Test List (Gate 5)

> **Gate 5 Rule**: Khóa danh sách kiểm thử này **TRƯỚC KHI** Coding Agent chỉnh sửa code sửa 2 lỗi. Mọi tiêu chí dưới đây ánh xạ trực tiếp sang Vitest specs (`mission-detail.spec.ts`, `missions-api.spec.ts`, `notifications-realtime.spec.ts`).

- **Approved By (QA/PO)**: Human Owner + Control Tower *(đã xác minh gốc lỗi FE)*
- **Approved Date**: `2026-11-27`

## 1. Happy Path & Core User Flows (Gherkin)

```gherkin
Feature: Mission Check-in Realtime & Mission AI Inspection Results

  Scenario: Mission Check-in updates UI state immediately without page reload
    Given a Mission in "Confirmed" state is open on Mission Detail / Inspector view
    When the Inspector completes Check-in OR a SignalR "MissionLifecycleEvent" arrives for that missionId
    Then the UI updates the mission status and check-in list immediately without requiring F5 reload
    And if the SignalR connection reconnects, the client automatically rejoins the mission group

  Scenario: AI Inspection results render on Mission Detail after Inspector uploads media
    Given an Inspector has uploaded images or video to a Mission and AI analysis finishes
    When the user views the "Kết quả giám định AI" section on Mission Detail
    Then the uploaded media runs and detected anomalies (including Emergency/Normal priority or 0-defect clean status) render clearly
    And a malformed field in one detection record does not hide valid results
```

## 2. Check-in Realtime Edge Cases

- [ ] Sau khi tự bấm Check-in thành công (HTTP 2xx), UI cập nhật ngay trạng thái `Ready` / bản ghi check-in mới mà **không cần F5**.
- [ ] Khi nhận SignalR `MissionLifecycleEvent` cho đúng `missionId` (từ thao tác của user khác), `MissionDetail` tự cập nhật trạng thái/dữ liệu Mission mà **không cần F5**.
- [ ] Event SignalR thuộc `missionId` khác bị bỏ qua (không gây reload/nhiễu màn hình hiện tại).
- [ ] Khi hủy component (`ngOnDestroy`), subscription SignalR và `LeaveMissionGroup` được dọn sạch (không memory leak, không gọi reload sau destroy).

## 3. Mission AI Inspection Results Edge Cases

- [ ] Parser `missions-api.ts` normalize đúng response thật của BE cho danh sách kết quả giám định AI của Mission (cả trường hợp có lỗi `Emergency`/`Normal`, ảnh 0 lỗi sạch, và trạng thái `Processing`/`Failed`).
- [ ] Khi AI phân tích xong (nhận event `AiAnalysisCompleted` / reload tab "Kết quả giám định AI"), kết quả hiển thị ngay trên màn hình Mission (không bị trống trắng).
- [ ] Giữ đúng ranh giới RBAC theo `MASTER_SYSTEM_SPEC.md`: `Inspector` thấy trạng thái nộp/kết quả phân tích (Thành công/Thất bại) nhưng **không** thấy nút duyệt `Approve`/`Reject` bbox của `Analyst`; `Analyst` có thể mở chi tiết thẩm định.
- [ ] Lỗi `403` hoặc `500` khi tải kết quả AI hiển thị thông báo tiếng Việt an toàn, không xóa nhầm hoặc treo trạng thái loading vĩnh viễn.

## 4. Verification & Quality Gates

- [ ] `npm run check:policy` pass (0 violations).
- [ ] `npm run check:arch` pass (0 violations).
- [ ] `npm run lint` pass (**0 errors, 0 warnings**).
- [ ] `npx ng test --watch=false` pass 100% (bao gồm các test mới cho Check-in realtime & Mission AI results — sẽ fail nếu phá logic lõi).
- [ ] `npm run build` pass (0 lỗi TS/template).
- [ ] Qua 1 lượt **Independent `FE-Review Judge`** (`APPROVE_FOR_HUMAN_REVIEW`) kèm **Tóm tắt luồng để bảo vệ code**.
