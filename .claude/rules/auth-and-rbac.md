---
paths:
  - "src/app/core/auth/**"
  - "src/app/features/users/**"
  - "src/app/features/settings/**"
---

# Quy tắc Auth, Silent Refresh & RBAC (FE)

1. `SystemAdmin` là Superuser 100%: không bị khóa/lọc bởi `UserGeographicScopes` ở bất kỳ màn hình nào, được dùng mọi chức năng và cấu hình `SystemSettings`.
2. Silent Refresh Token trong `src/app/core/auth/` phải chủ động refresh trước khi Access Token hết hạn và khóa hàng đợi `isRefreshing` khi gặp `401` để retry request đang chạy, không tự văng đăng xuất user đang thao tác.
3. Chỉ dùng đúng 5 role chuẩn (`SystemAdmin`, `Manager`, `Inspector`, `Analyst`, `Technician`); multi-role lấy hợp (union) quyền.
4. Cấm `console.log`/`debug`/`info` JWT, OTP, mật khẩu, email hay payload thô (`check:policy` sẽ chặn).
