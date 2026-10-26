# SafeDistance Live – iOS native thực sự, dùng Windows + iPhone 11 (không cần Mac)

**Đây là dự án build, KHÔNG phải IPA đã build.** Muốn cài cần chạy GitHub Actions để tạo file unsigned IPA, rồi ký bằng Apple ID miễn phí qua Sideloadly trên Windows. App thuộc dạng *sideload*, không phải phát hành App Store.

## Có gì trong app

- Tốc độ GPS km/h khi app mở (expo-location), quyền "When In Use". Khi iOS cấp speed dùng dữ liệu native; nếu không, có fallback dựa vào tọa độ khi độ chính xác phù hợp; sai số GPS có thể lớn.
- Camera sau: chụp ảnh, chọn ảnh, xem depth map giả màu và giá trị ước lượng tại pixel.
- Hai model thật `metric_only.onnx`, `metric_kd_grad.onnx` từ V11.8, xử lý ONNX trên iPhone (CPU, offline). Không có 30 FPS AI video, không có logic cảnh báo phanh/va chạm.
- Vị trí GPS không upload; code không gửi lên server. Không chạy GPS khi app ở background.

## 1. Build IPA trên GitHub Actions

1. Tạo tài khoản GitHub miễn phí nếu chưa có.
2. Tạo repository mới, ưu tiên **Private** để model/source không bị public. GitHub Free có quota phút Actions; không bảo đảm build luôn miễn phí nếu vượt hạn mức. Nếu repo private bị giới hạn Actions macOS, dùng public *chỉ khi bạn đồng ý công khai mã nguồn và mô hình*.
3. Giải nén ZIP này. Upload **nội dung bên trong thư mục** `SafeDistance_iOS_Native_FreeSideload` lên root repository GitHub (không upload riêng file ZIP). Quan trọng: thêm file ẩn `.github/workflows/ios-unsigned-ipa.yml` và `.gitignore`.
4. GitHub > **Actions** > workflow **Build unsigned iPhone IPA** > **Run workflow**.
5. Nếu build thành công: workflow run > **Artifacts** > `SafeDistance-unsigned-IPA` > download ZIP của GitHub, giải nén để lấy `SafeDistance-unsigned.ipa`.
6. Nếu build lỗi, gửi nguyên log bước màu đỏ, đặc biệt `Install CocoaPods` hoặc `Build iOS Release without signing`.

**Cảnh báo:** Đây là pipeline không ký mã (code signing disabled). Mình chưa chạy trên GitHub macOS để xác nhận thành công và không thể xuất IPA trực tiếp từ môi trường hiện tại. Vì các phiên bản RN / ONNX / Pods có thể thay đổi, có thể cần sửa CI sau khi thấy build log.

## 2. Ký và cài từ Windows 11 (Apple ID miễn phí)

1. Tải Sideloadly từ website **https://sideloadly.io/** hoặc xem hướng dẫn https://sideloadly.io/faq . Đây là công cụ bên thứ ba: chỉ tải từ nguồn bạn tin tưởng, cân nhắc rủi ro khi đăng nhập Apple ID. Sử dụng Apple ID phụ là một lựa chọn an toàn hơn.
2. Nếu Sideloadly cần, cài phiên bản iTunes/iCloud Windows từ nguồn Apple được hướng dẫn tại website Sideloadly.
3. Kết nối iPhone bằng USB và bấm **Trust this computer** trên iPhone.
4. Mở Sideloadly, chọn iPhone, kéo `SafeDistance-unsigned.ipa`, đăng nhập Apple ID miễn phí theo quy trình, nhấn Start để ký và cài.
5. Trên iPhone: **Settings > Privacy & Security > Developer Mode** (nếu yêu cầu), khởi động lại, xác nhận. Có thể cần tin cậy developer profile tại **Settings > General > VPN & Device Management**.
6. Mở SafeDistance Live và cấp quyền Location While Using và Camera.

**Giới hạn:** ứng dụng ký bằng Apple ID miễn phí thường chỉ dùng được **7 ngày**, sau đó cần ký lại trên Windows. Công cụ sideload có thể bị Apple giới hạn số app đang hoạt động. Không có bảo đảm tương thích hoàn hảo với iOS 26.4 trước khi thử máy thật.

## 3. Vì sao không dùng EAS Build để cài miễn phí?

EAS Build ad hoc cho iPhone thật dùng provisioning của Apple Developer Program trả phí. GitHub Actions ở đây build **unsigned IPA** rồi để Sideloadly ký lại bằng tài khoản miễn phí trên máy của bạn. Đây là con đường thử nghiệm, không phải quy trình phân phối chuẩn của Expo.

## 4. Nếu chấp nhận tài khoản Apple Developer trả phí

Bộ dự án cũng có `eas.json`; `eas build --platform ios --profile preview` và EAS sẽ cho phép cài ad hoc đúng quy trình, không gia hạn 7 ngày. Tài khoản Apple Developer Program hiện giá **99 USD/năm** ở Mỹ (giá địa phương có thể khác).

## 5. Giới hạn nghiên cứu và an toàn

Bài toán depth model hiện chỉ được đánh giá trên DAIR Example nhỏ, ROI gần dưới 20 m chưa có kiểm chứng. Tốc độ GPS và ước lượng độ sâu được hiển thị **để nghiên cứu đồ án, không dùng làm cảnh báo an toàn khi lái xe**. Nếu cần dùng app trong xe, chỉ để người ngồi ghế phụ thao tác.

Tài liệu: https://docs.expo.dev/versions/v55.0.0/sdk/location/ ; https://github.com/actions/runner-images ; https://sideloadly.io/faq ; https://docs.github.com/en/billing/concepts/product-billing/github-actions
