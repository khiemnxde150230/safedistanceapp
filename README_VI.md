# SafeDistance Depth Lab – React Native iOS (iPhone 11)

**Bản source app 0.1.0, chưa ký mã iOS / chưa chạy thử trên iPhone thật.**

## Đã có gì?

- **Hai model ONNX thật** được sao chép nguyên vẹn từ assets V11.8 (trọng số huấn luyện V11.6, xuất ONNX V11.7.1).
- Chụp ảnh từ camera sau hoặc chọn ảnh có sẵn.
- Xử lý **offline trên iPhone** bằng `onnxruntime-react-native` CPU (không cần server, API hay tải model sau cài đặt).
- Resize méo tỷ lệ về **640 × 192**, chuẩn hóa RGB `/255`, NCHW float32, đúng preprocessing benchmark V11.8.
- Bản đồ độ sâu giả màu, **chạm điểm** đọc giá trị độ sâu ước lượng (m); chọn Metric Only hoặc KD + Gradient; xem thời gian suy luận.

**Chưa có:** camera 30 FPS, object detection/vehicle ROI, hiệu chuẩn camera/scale mới, cảnh báo an toàn, bài kiểm tra độ chính xác trên iPhone, IPA đã ký/cài được ngay.

> **Cảnh báo an toàn**: Giá trị độ sâu từ bộ DAIR Example nhỏ chưa được chứng minh đáng tin cậy (đặc biệt dưới 20 m). Không dùng app để lái xe hoặc cảnh báo phanh/khoảng cách thực tế. Chỉ sử dụng trong thử nghiệm đồ án.

## Đường dẫn chính

```text
App.js                             # Giao diện camera / heatmap / chạm xem depth
src/depthPipeline.js               # ONNX Runtime + image preprocessing
assets/models/metric_only.onnx     # 750,562 bytes
assets/models/metric_kd_grad.onnx  # 750,562 bytes
assets/MODEL_MANIFEST.json         # SHA256 / model provenance / input spec
metro.config.js                    # Bundle ONNX assets vào iOS build
app.json                           # Quyền camera, plugin ONNX RN, bundle ID
package.json
babel.config.js
eas.json                         # Build ad-hoc iOS / preview
scripts/verify-assets.js
```

## 1. Chuẩn bị

- Máy tính có **Node.js 22** và npm.
- iPhone 11 với iOS 26.4 (có hỗ trợ hệ điều hành iOS 26).
- **Bản cài iOS native**: không dùng Expo Go, vì `onnxruntime-react-native` là module native.
- Hai lựa chọn ký ứng dụng: (A) Xcode trên Mac tương thích với **Xcode 26**, Apple Account miễn phí (7 ngày ký lại); hoặc (B) Apple Developer Program trả phí + Expo EAS cloud build/ad-hoc hoặc TestFlight.
- Trên Mac Ventura cũ, Xcode 26.4.1 không chạy được: cần nâng macOS/máy hoặc dùng cloud build với tài khoản Developer trả phí.

## 2. Cài package, kiểm tra models

Giải nén ZIP, mở Terminal tại thư mục dự án:

```bash
npm install
npx expo install --fix
npm run check:assets
npx expo-doctor
```

Nếu `expo install --fix` cập nhật các package tương thích với Expo SDK 55 thì chấp nhận thay đổi. Nếu Xcode build báo lỗi package, lưu nguyên log để đối chiếu; code chưa được test trên Xcode thật.

## 3A. Không có Apple Developer trả phí – cài bằng Xcode trên Mac

Đòi hỏi Xcode hỗ trợ iOS 26.4 và Mac đủ mới. Theo bảng Apple, Xcode 26.4.1 yêu cầu macOS Tahoe 26.2 trở lên.

1. Mở Xcode > Settings > Accounts > đăng nhập Apple Account.
2. Kết nối iPhone qua cáp, bật Developer Mode trên iPhone nếu được yêu cầu.
3. Trong thư mục project, chạy:

```bash
npx expo prebuild --platform ios
open ios/*.xcworkspace
```

4. Trong Xcode, chọn project app target > **Signing & Capabilities** > **Automatically manage signing** và chọn **Personal Team** (Apple ID). Sửa Bundle Identifier trong Xcode/app.json nếu trùng.
5. Chọn iPhone vật lý làm target, kiểm tra Run Scheme. Để cài **bản không cần Metro** (sau khi ký thành công), dùng cấu hình Release:

```bash
npx expo run:ios --configuration Release --device
```

6. Nếu Apple Personal Team hết hạn sau 7 ngày, cần ký/build/cài lại. Trong lúc phát triển có thể dùng debug build + `npx expo start --dev-client`, nhưng build debug sẽ cần Metro. Bản Release mới phù hợp để mở offline.

> Không thể gửi một `.ipa` bất kỳ để cài lên iPhone chưa được ký/provision đúng cho thiết bị.

## 3B. Muốn cài qua QR/link, không dùng Xcode local – EAS Build

**Cần Apple Developer Program trả phí để ad hoc cài trực tiếp**, và iPhone phải được đăng ký vào provisioning profile.

```bash
npm install -g eas-cli
eas login
eas build:configure
eas device:create
eas build --platform ios --profile preview
```

Làm theo lời nhắc đăng nhập Apple Developer và tạo chứng chỉ. Sau khi build hoàn tất, mở liên kết/QR của EAS trên chính iPhone để cài app. Vào Settings > Privacy & Security > Developer Mode nếu iOS yêu cầu, sau đó mở lại ứng dụng.

## 4. Cách dùng

1. Mở app `SafeDistance Depth Lab`, cấp quyền camera.
2. Chọn **Metric Only** (default) hoặc **Metric + KD + Gradient**.
3. Chạm **Chụp & phân tích** hoặc **Chọn ảnh** từ thư viện.
4. App thực hiện resize (640×192), RGB / 255 và ONNX inference CPU ngay trên thiết bị.
5. Chuyển **Ảnh gốc ↔ Bản đồ độ sâu**, chạm vào ảnh để xem **độ sâu ở pixel đang chọn**; không suy diễn đó là khoảng cách tới đầu xe.
6. Xem `ONNX infer` và `Tổng pipeline`. Số này chỉ đo lần chụp hiện tại, không phải FPS camera.

## 5. Phương pháp & hạn chế cần viết trong đồ án

- Input đúng preprocessing V11.8 (có thêm một vòng encode/decode JPEG trong JavaScript, gây khác biệt pixel nhỏ).
- Mô hình từng đạt Sparse AbsRel **0.3778** (Metric Only) và **0.3970** (KD + Gradient) trên DAIR Example pilot V11.6. Đây **không phải** kết quả đánh giá ảnh iPhone hoặc hiệu quả trên môi trường mới.
- iPhone 11 không có LiDAR; app dùng đơn camera RGB và dự đoán monocular, không đo trực tiếp như sensor ToF/LiDAR.
- Màu heatmap tự cân chỉnh theo P5/P95 từng ảnh, **không** phải màu có độ sâu tuyệt đối cố định.
- Chưa có vehicle detector hay đo bounding box/ROI. Giá trị ở một điểm khác với khoảng cách xe thực.
- Chưa benchmark iPhone 11 / iOS 26.4; số latency/FPS V11.8 trên CPU Kaggle không được sử dụng làm số iPhone.
- `.onnx` đã được nhúng offline vào binary; không tải qua Internet sau khi app được cài đúng.

## 6. Nếu lỗi

- **Cannot find onnxruntime-react-native**: đã dùng `expo start`/Expo Go thay vì native build. Dùng Xcode hoặc EAS build iOS.
- **failed to load model**: app đã copy ONNX từ bundle vào `documentDirectory/onnx_models`. Xem log cả URI `file://` và path fallback. Kiểm tra Metro có nhận assetExt `onnx`.
- **ImageManipulator lỗi**: kiểm tra Expo SDK 55, `npx expo install --fix`, quyền ảnh.
- **Ký app thất bại**: Xcode chọn Personal Team hoặc cần tài khoản Developer Program cho EAS.
- **Thiếu quyền camera**: iOS Settings > SafeDistance Depth Lab > Camera.

## Tài liệu tham khảo chính thức

- ONNX Runtime RN: https://onnxruntime.ai/docs/get-started/with-javascript/react-native.html
- Expo native code: https://docs.expo.dev/workflow/customizing/
- Expo Camera: https://docs.expo.dev/versions/v55.0.0/sdk/camera/
- EAS iOS ad-hoc: https://docs.expo.dev/build/internal-distribution/
- Apple Personal Team: https://developer.apple.com/help/account/basics/about-your-developer-account
