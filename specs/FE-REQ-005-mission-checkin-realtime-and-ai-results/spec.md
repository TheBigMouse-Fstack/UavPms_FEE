# [FE-REQ-005] Mission Check-in Realtime Update & Mission AI Inspection Results Display

- **Req ID**: `FE-REQ-005`
- **Phase / Batch**: Hotfix / Mainflow Blocker (ưu tiên để chạy thông suốt MF: Check-in → Inspector gửi ảnh/video lên AI → tra kết quả giám định AI trên màn hình Mission)
- **Status**: `confirmed` *(đã chẩn đoán chính xác gốc lỗi FE và chốt Gate 5 ngày 2026-11-27 theo chỉ thị ưu tiên chạy MF)*
- **Owner (BA/PO)**: Control Tower / Frontend Owner
- **Named Approver (Tech/Security)**: Independent PR Review Judge + Human Owner
- **Data Classification** *(per `docs/AI_SECURITY_AND_GOVERNANCE.md`)*: `Sensitive` (ảnh/video UAV, kết quả phát hiện khuyết tật AI, tọa độ/trạng thái Mission — không log raw payload, dùng dữ liệu synthetic scrubbed trong unit test)

## 1. Problem & Goal (What & Why)

Trong quá trình chạy thực tế luồng chính (Mainflow: Check-in → Inspector gửi ảnh/video lên AI → AI phân tích → tra kết quả trên màn hình Mission), ghi nhận 2 lỗi chặn luồng:
1. **Check-in Mission chưa realtime (phải F5 / tải lại trang mới thấy đổi trạng thái)**:
   - Khi `Inspector` thực hiện Check-in hiện trường (chuyển trạng thái Mission `Confirmed` → `Ready` hoặc cập nhật danh sách check-in), giao diện không tự cập nhật ngay theo thời gian thực (cho chính người thao tác và/hoặc `Manager` đang mở màn hình `mission-detail`), buộc phải F5 tải lại trang.
2. **Màn hình Mission → khu vực "Kết quả giám định AI" không hiển thị kết quả ở FE**:
   - Sau khi `Inspector` gửi ảnh/video lên AI phân tích xong, khi mở màn hình chi tiết Mission để tra cứu mục "Kết quả giám định AI", danh sách/kết quả không hiển thị trên FE (cần khoanh vùng chính xác do parser/API/role guard phía FE hay do response BE thiếu mảng `detections` / sai tên trường).

**Goal**:
- Bảo đảm trạng thái Check-in Mission cập nhật **realtime ngay lập tức không cần F5** (cả ngay sau khi HTTP check-in thành công lẫn qua SignalR `MissionLifecycleEvent` / `JoinMissionGroup` khi người khác check-in).
- Bảo đảm sau khi `Inspector` gửi ảnh/video lên AI và AI phân tích xong, màn hình Mission **hiển thị đầy đủ và chính xác trạng thái/kết quả giám định AI** theo đúng quyền vai trò trong [docs/MASTER_SYSTEM_SPEC.md](../../docs/MASTER_SYSTEM_SPEC.md) (Mục 4 & Luồng 4A).

## 2. Scope & Non-Goals

- **In Scope** *(gốc lỗi đã xác minh từ chẩn đoán READ-ONLY)*:
  1. **Sửa lỗi #1 — Check-in Mission realtime (không cần F5)**:
     - `mission-detail.ts` & `mission-inspector.ts`: bổ sung xử lý `event.type === 'CHECKED_IN' | 'STARTED' | 'COMPLETED'` trong `handleMissionRealtimeEvent` để tự gọi `this.api.get(currentMission.id)` đồng bộ trạng thái thật + `checkedInAt`.
     - `mission-detail.ts` (`checkInFlight`): gọi thêm `this.api.get(id)` sau HTTP 2xx để đồng bộ trạng thái thật (`Preparing`/`Ready`, `checkedInAt`).
     - `notifications-realtime.ts`: đăng ký listener dự phòng cho `MissionCheckedIn` / `AssignmentCheckedIn` / `MissionStarted` / `MissionCompleted`, và **không ép cứng** `MissionUpdated` về `'CONFIRMED'` khi payload có `status` khác.
     - Mở rộng polling dự phòng nhẹ (5s, tự hủy khi `ngOnDestroy` hoặc trạng thái kết thúc) sang trạng thái `Confirmed` / `Preparing` để các tab khác vẫn cập nhật tự động kể cả khi BE server cũ chưa phát sự kiện SignalR cho check-in.
     - **Ràng buộc bảo mật (khớp BE `N1` P0-3)**: **KHÔNG** thêm lời gọi client-side `broadcastMissionEvent()` mới (vì BE đã gỡ toàn bộ client `Broadcast*` Hub RPCs).
  2. **Sửa lỗi #2 — Màn hình Mission → "Kết quả giám định AI" hiển thị kết quả ở FE**:
     - `mission-detail.ts` (`loadDetections`): bỏ guard sai `if (isAdminRole(this.userRole())) { this.detections.set([]); return; }` khiến tài khoản `SystemAdmin`/`Admin` luôn bị trắng danh sách; hiển thị thông báo lỗi UI rõ ràng ở nhánh `error:` thay vì nuốt lỗi im lặng.
     - `missions-api.ts` (`itemsValue` / `getMissionDetections`): bổ sung fallback đọc key `detections` và `results` ngoài mảng trực tiếp / `items` bằng `src/app/shared/utils/`.
     - `mission-detail.ts`: sau khi `uploadSelectedMedia()` chuyển sang tab `processing` (hoặc khi người dùng ở tab `processing`/`results` và media còn đang phân tích), bổ sung polling nhẹ 5s (tự dừng ngay khi hoàn tất / có kết quả / đổi tab / `ngOnDestroy`) làm lưới an toàn bên cạnh SignalR `AiAnalysisStatusChanged`.
  3. **Vitest unit tests** ánh xạ 1–1 Gate 5 `acceptance.md`.
- **Non-Goals (Explicitly Out of Scope)**:
  - **KHÔNG** xử lý ràng buộc `towerId` (ép defect gắn cột điện) trong REQ này (để riêng theo chỉ thị chủ hệ thống).
  - **KHÔNG** bật lại `Active Learning`, `Emergency Alerts`, hay `drone-handover`.
  - **KHÔNG** chạm vùng Human-Approval-Required (`src/app/core/auth/**`, `src/app/features/gis/**`, `docs/AI_SECURITY_AND_GOVERNANCE.md`, `.github/workflows/**`) nếu chưa có phê duyệt tường minh.
  - **KHÔNG** vi phạm ranh giới RBAC của `MASTER_SYSTEM_SPEC.md` (chỉ `Analyst` có nút duyệt `Approve`/`Reject` bbox; `Inspector` chỉ thấy trạng thái nộp/phân tích Thành công/Thất bại, không tự duyệt lỗi).

## 3. Data & Realtime Contract

- **Check-in Realtime**:
  - Ngay khi API Check-in trả 2xx: cập nhật ngay trạng thái Mission & danh sách `checkIns` trong signal/store mà không cần F5.
  - Khi nhận sự kiện SignalR `MissionLifecycleEvent` cho đúng `missionId` (sau khi đã `JoinMissionGroup(missionId)` và tự rejoin sau `onreconnected`): cập nhật trạng thái/reload snapshot Mission tự động, kèm guard tránh reload trùng lặp.
- **Mission AI Inspection Results**:
  - Hỗ trợ đọc an toàn các dạng payload thực tế BE đang trả cho media/runs/detections của Mission qua `src/app/shared/utils/` (không `any`, không để 1 bản ghi thiếu field làm mất toàn bộ danh sách).
  - Khi nhận sự kiện AI phân tích xong (hoặc mở lại tab "Kết quả giám định AI"): hiển thị rõ trạng thái phân tích (`Pending`/`Processing`/`Completed`/`Failed`), số lượng lỗi / ảnh sạch (0 lỗi), mức độ `Emergency` | `Normal`, và liên kết chuyển sang `Analyst Review` cho user có quyền `Analyst`.

## 4. Security, Privacy, Readability & NFRs

- [x] Không log raw payload, JWT, tọa độ hay URL S3 nhạy cảm ra console.
- [x] Tuân thủ Angular 21 (`OnPush`, signals, `inject()`, native control flow, không `any`, WCAG 2.2 AA).
- [x] Tuân thủ `readable-code-defense/SKILL.md` (luồng tuyến tính, tối đa 2 cấp `if`, không nested ternary, comment tiếng Việt giải thích TẠI SAO).
- [x] Tuân thủ Quy trình v2.0 (`AGENTS.md` Mục 5): 1 Vertical Slice gọn (~250–450 dòng), test nhắm mục tiêu khi lặp → 1 lần `npm run verify:all` cuối + 1 lượt Independent `FE-Review Judge`.
