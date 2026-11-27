---
paths:
  - "src/app/features/notifications/**"
  - "src/app/core/services/**"
  - "src/app/features/ai-inspection/**"
  - "src/app/features/maintenance/**"
---

# Quy tắc Notification Dedupe, List Ordering & UI Đồng nhất (FE)

1. Mọi danh sách (Defects, Missions, Tickets, Notifications, Reports) mặc định xếp item mới nhất / gần nhất lên đầu (`DESC`).
2. Popup/Toast Notification bắt buộc deduplicate theo `notificationId`/`eventId` (hoặc khóa dự phòng `type + referenceId + actorId`) trước khi hiện UI — tuyệt đối không bật trùng 2 popup.
3. Tab Kết quả giám định phải đồng nhất nguồn dữ liệu cho mọi thành viên Mission (cùng trạng thái thật, `towerCode`, BBox `0..100%`), chỉ ẩn/khóa nút `Approve`/`Reject` nếu không phải `Analyst` của Mission hoặc `SystemAdmin`.
4. Sau khi defect đã duyệt: bỏ sạch toàn bộ chữ `"AI Review"` / `"Chờ AI"`; xóa toàn bộ placeholder `"N/A"`; bỏ chọn `preferredModel`; khóa upload Ảnh ≤ 20MB / Video ≤ 200MB; parse date/payload qua `src/app/shared/utils/`.
