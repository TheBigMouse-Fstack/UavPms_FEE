---
paths:
  - "src/app/features/gis/**"
  - "src/app/shared/gis/**"
  - "src/app/features/missions/**"
  - "src/app/features/pre-mission/**"
---

# Quy tắc Local-Only GIS, Check-in 50m & Telemetry MF03 (FE)

1. Mọi bản đồ PHẢI dùng `src/app/shared/gis/local-gis.ts` (`/maps/evnspc-south-z12.pmtiles` + schematic local fallback). Cấm tuyệt đối tile URL bên ngoài (`google`, `osm`, `mapbox`, `carto`, `arcgis`, CDN).
2. Mọi URL ảnh/tile/tài nguyên bản đồ phải đi qua URL firewall same-origin; không chấp nhận `//` hay cross-origin `blob:`.
3. Check-in hiện trường tại Mission chỉ hiển thị nút cho `Inspector` được gán (và `SystemAdmin`), đối chiếu GPS quanh Cột điện số 1 (`sequence = 1`, bán kính cấu hình mặc định `50m`), cập nhật realtime qua SignalR.
4. Telemetry MF03 nhận qua `/hubs/telemetry`, không dùng timer/script giả lập đường bay. Pre-Mission MF01 KHÔNG hiển thị màn kiểm tra kỹ thuật/BIST Drone và chỉ chọn số lượng nhân sự theo role.
