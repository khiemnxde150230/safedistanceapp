import React, { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { inferPhoto, modelLabel, sampleDepth } from './src/depthPipeline';

const NAVY = '#091524';
const PANEL = '#122238';
const BORDER = '#25364e';
const TEAL = '#50ddd2';
const WHITE = '#eaf4fb';
const MUTED = '#9eb1c6';

function Action({ title, action, disabled, secondary }) {
  return (
    <Pressable onPress={action} disabled={disabled} style={[styles.button, secondary ? styles.secondaryButton : styles.primaryButton, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.buttonText, secondary && { color: WHITE }]}>{title}</Text>
    </Pressable>
  );
}

function DepthApp() {
  const camera = useRef(null);
  const photoUri = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [modelKey, setModelKey] = useState('metric_only');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [probe, setProbe] = useState(null);
  const [layout, setLayout] = useState({ width: 1, height: 1 });
  const [error, setError] = useState('');
  const [showCamera, setShowCamera] = useState(true);
  const [showHeat, setShowHeat] = useState(true);

  const gpsSubscription = useRef(null);
  const lastGpsFix = useRef(null);
  const [gpsRunning, setGpsRunning] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(null);
  const [speedSource, setSpeedSource] = useState('Đang chờ GPS');
  const [gpsAccuracy, setGpsAccuracy] = useState(null);
  const [gpsError, setGpsError] = useState('');

  function distanceMeters(lat1, lon1, lat2, lon2) {
    const radius = 6371000;
    const rad = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * rad / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
      Math.sin((lon2 - lon1) * rad / 2) ** 2;
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function processFix(fix) {
    const {latitude, longitude, speed, accuracy} = fix.coords || {};
    const horizontal = typeof accuracy === 'number' && Number.isFinite(accuracy) ? accuracy : null;
    setGpsAccuracy(horizontal);
    let computed = null;
    let method = 'Tín hiệu GPS chưa đủ tốt';
    if (horizontal !== null && horizontal <= 60 && typeof speed === 'number' && Number.isFinite(speed) && speed >= 0) {
      computed = speed * 3.6;
      method = 'Tốc độ GPS của iPhone';
    } else {
      const old = lastGpsFix.current;
      if (horizontal !== null && horizontal <= 25 && old && old.acc <= 25) {
        const seconds = (fix.timestamp - old.timestamp) / 1000;
        const meters = distanceMeters(old.lat, old.lon, latitude, longitude);
        // Very small displacements are dominated by GPS jitter. Never claim they are speed.
        if (seconds >= 2 && seconds <= 30 && meters > Math.max(8, horizontal, old.acc)) {
          computed = meters / seconds * 3.6;
          method = 'Ước lượng bằng tọa độ';
        }
      }
    }
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && horizontal !== null) {
      lastGpsFix.current = {lat: latitude, lon: longitude, timestamp: fix.timestamp, acc: horizontal};
    }
    setSpeedKmh(computed === null ? null : Math.max(0, Math.min(250, computed)));
    setSpeedSource(method);
  }

  async function toggleGps() {
    if (gpsRunning) {
      gpsSubscription.current?.remove();
      gpsSubscription.current = null;
      setGpsRunning(false);
      setSpeedKmh(null);
      setSpeedSource('Đã tắt');
      return;
    }
    setGpsError('');
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setGpsError('Bạn cần cho phép vị trí khi đang sử dụng ứng dụng.');
        return;
      }
      if (!(await Location.hasServicesEnabledAsync())) {
        setGpsError('Hãy bật Location Services trong Cài đặt iPhone.');
        return;
      }
      lastGpsFix.current = null;
      const sub = await Location.watchPositionAsync(
        {accuracy: Location.Accuracy.BestForNavigation, distanceInterval: 1},
        processFix,
        (reason) => setGpsError(String(reason))
      );
      gpsSubscription.current = sub;
      setGpsRunning(true);
      setSpeedSource('Đang bắt tín hiệu GPS…');
    } catch (e) {
      setGpsError(String(e?.message ?? e));
    }
  }

  useEffect(() => () => {
    gpsSubscription.current?.remove();
  }, []);

  async function analyze(uri, variant = modelKey) {
    if (busy) return;
    photoUri.current = uri;
    setError('');
    setBusy(true);
    setShowCamera(false);
    setResult(null);
    // Give the UI a chance to show the spinner before synchronous jpeg-js decoding.
    await new Promise((resolve) => setTimeout(resolve, 30));
    try {
      const data = await inferPhoto(uri, variant);
      setResult(data);
      setProbe(data.selected);
      setShowHeat(true);
    } catch (e) {
      const message = String(e?.message ?? e);
      setError(message);
      Alert.alert('Không thể suy luận độ sâu', message);
    } finally {
      setBusy(false);
    }
  }

  async function takePhoto() {
    try {
      if (!permission?.granted) {
        const p = await requestPermission();
        if (!p.granted) return;
      }
      if (!camera.current) return;
      const photo = await camera.current.takePictureAsync({ quality: 0.8, skipProcessing: false });
      if (photo?.uri) await analyze(photo.uri);
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  }

  async function fromGallery() {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
      if (!picked.canceled && picked.assets?.[0]?.uri) await analyze(picked.assets[0].uri);
    } catch (e) { setError(String(e?.message ?? e)); }
  }

  async function changeModel(next) {
    if (busy || next === modelKey) return;
    setModelKey(next);
    if (photoUri.current) await analyze(photoUri.current, next);
  }

  function onMapPress(e) {
    if (!result) return;
    const nx = Math.max(0, Math.min(1, e.nativeEvent.locationX / layout.width));
    const ny = Math.max(0, Math.min(1, e.nativeEvent.locationY / layout.height));
    setProbe(sampleDepth(result.depth, nx, ny));
  }

  const cameraReady = permission?.granted;
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.main}>
        <View style={styles.topline}>
          <Text style={styles.eyebrow}>SAFEDISTANCE · V11.8</Text>
          <Text style={styles.tag}>OFFLINE AI</Text>
        </View>
        <Text style={styles.heading}>SafeDistance Live</Text>
        <Text style={styles.subheading}>Tốc độ GPS realtime và dự đoán độ sâu offline từ ảnh bằng ONNX Runtime.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Tốc độ GPS trực tiếp</Text>
          <View style={styles.gpsRow}>
            <Text style={styles.speedNumber}>{speedKmh === null ? '—' : speedKmh.toFixed(1)}</Text>
            <Text style={styles.speedUnit}>km/h</Text>
          </View>
          <Text style={styles.helper}>{speedSource} · Độ chính xác: {gpsAccuracy === null ? '—' : Math.round(gpsAccuracy) + ' m'}</Text>
          {gpsError ? <Text style={styles.errorText}>{gpsError}</Text> : null}
          <View style={styles.actions}>
            <Action title={gpsRunning ? 'Dừng GPS' : 'Bật GPS realtime'} action={toggleGps} secondary={gpsRunning} />
          </View>
          <Text style={styles.smallNote}>Chỉ cập nhật khi app mở. Khi đứng yên, GPS có thể dao động; không dùng để ra quyết định lái xe.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mô hình</Text>
          <View style={styles.variants}>
            {['metric_only', 'metric_kd_grad'].map((key) => (
              <Pressable key={key} disabled={busy} onPress={() => changeModel(key)} style={[styles.variant, key === modelKey && styles.variantActive]}>
                <Text style={[styles.variantText, key === modelKey && { color: NAVY }]}>{modelLabel(key)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helper}>Hai model cùng kiến trúc 185.529 tham số, đầu vào RGB 640×192.</Text>
        </View>

        {showCamera && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Camera</Text>
            <View style={styles.cameraFrame}>
              {cameraReady ? (
                <CameraView style={StyleSheet.absoluteFill} facing="back" ref={camera} mode="picture" />
              ) : (
                <View style={styles.cameraPrompt}>
                  <Text style={styles.info}>Cần quyền camera để chụp ảnh.</Text>
                  <Action title="Cấp quyền camera" action={requestPermission} secondary />
                </View>
              )}
            </View>
            <View style={styles.actions}>
              <Action title="Chụp & phân tích" action={takePhoto} disabled={!cameraReady || busy} />
              <Action title="Chọn ảnh" action={fromGallery} disabled={busy} secondary />
            </View>
          </View>
        )}

        {!showCamera && (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.cardTitle}>Kết quả phân tích</Text>
              <Pressable disabled={busy} onPress={() => { setShowCamera(true); setResult(null); setProbe(null); photoUri.current = null; }}>
                <Text style={styles.link}>Chụp lại</Text>
              </Pressable>
            </View>
            {busy ? (
              <View style={styles.loading}><ActivityIndicator size="large" color={TEAL} /><Text style={styles.helper}>Đang xử lý ảnh và suy luận offline…</Text></View>
            ) : result ? (
              <>
                <View style={styles.toggleRow}>
                  <Pressable onPress={() => setShowHeat(false)} style={[styles.toggle, !showHeat && styles.toggleActive]}>
                    <Text style={[styles.toggleLabel, !showHeat && styles.toggleLabelActive]}>Ảnh gốc</Text>
                  </Pressable>
                  <Pressable onPress={() => setShowHeat(true)} style={[styles.toggle, showHeat && styles.toggleActive]}>
                    <Text style={[styles.toggleLabel, showHeat && styles.toggleLabelActive]}>Bản đồ độ sâu</Text>
                  </Pressable>
                </View>
                <Pressable style={styles.map} onLayout={(e) => setLayout({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} onPress={onMapPress}>
                  <Image source={{ uri: showHeat ? result.heatUri : result.rgbUri }} style={styles.mapImage} resizeMode="stretch" />
                  {probe && <View pointerEvents="none" style={[styles.crosshair, { left: `${probe.nx * 100}%`, top: `${probe.ny * 100}%` }]} />}
                </Pressable>
                <View style={styles.legendRow}>
                  <Text style={styles.helper}>Gần (màu ấm)</Text><Text style={styles.helper}>Xa (màu lạnh)</Text>
                </View>
                <Text style={styles.smallNote}>Màu được chuẩn hóa theo từng ảnh (P5–P95); không phải thang mét cố định. Chạm vào ảnh để xem một điểm.</Text>
                <View style={styles.metricCard}>
                  <Text style={styles.metricLabel}>Độ sâu ước lượng tại điểm được chọn</Text>
                  <Text style={styles.bigMetric}>{probe && Number.isFinite(probe.meters) ? probe.meters.toFixed(2) : '—'} <Text style={styles.meter}>m</Text></Text>
                  <Text style={styles.helper}>Tọa độ pixel: {probe?.x ?? '—'}, {probe?.y ?? '—'} · Không phải khoảng cách tới xe.</Text>
                </View>
                <View style={styles.stats}>
                  <View><Text style={styles.statLabel}>ONNX infer</Text><Text style={styles.statValue}>{result.inferenceMs} ms</Text></View>
                  <View><Text style={styles.statLabel}>Tổng pipeline</Text><Text style={styles.statValue}>{result.totalMs} ms</Text></View>
                  <View><Text style={styles.statLabel}>Thiết bị</Text><Text style={styles.statValue}>CPU / Offline</Text></View>
                </View>
                <Action title="Phân tích lại ảnh" action={() => analyze(photoUri.current)} secondary />
              </>
            ) : error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        )}

        <View style={styles.warning}>
          <Text style={styles.warningTitle}>GIỚI HẠN NGHIÊN CỨU</Text>
          <Text style={styles.warningText}>Đây là ứng dụng demo đồ án, không phải hệ thống tránh va chạm. Mô hình mới được thử nghiệm trên bộ DAIR Example nhỏ, chưa kiểm chứng đủ với xe cách dưới 20 m. Không sử dụng kết quả để lái xe, phanh hay đưa ra quyết định an toàn.</Text>
        </View>
        <Text style={styles.footer}>V11.6 weights · V11.7.1 ONNX export · iOS photo demo</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return <SafeAreaProvider><DepthApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: NAVY },
  main: { padding: 18, paddingBottom: 40 },
  topline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  eyebrow: { fontSize: 11, letterSpacing: 2, fontWeight: '800', color: TEAL },
  tag: { backgroundColor: '#214e55', color: '#9df8ec', fontSize: 10, fontWeight: '800', overflow: 'hidden', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  heading: { fontSize: 35, fontWeight: '800', color: WHITE, marginTop: 12, letterSpacing: -1 },
  subheading: { color: MUTED, fontSize: 14, lineHeight: 21, marginTop: 5, marginBottom: 20 },
  card: { borderRadius: 20, borderWidth: 1, borderColor: BORDER, backgroundColor: PANEL, padding: 14, marginBottom: 16 },
  cardTitle: { color: WHITE, fontSize: 16, fontWeight: '800', marginBottom: 12 },
  variants: { flexDirection: 'row', gap: 8 },
  variant: { flex: 1, paddingHorizontal: 8, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1a314c', borderRadius: 10 },
  variantActive: { backgroundColor: TEAL },
  variantText: { color: WHITE, fontWeight: '700', fontSize: 11, textAlign: 'center' },
  helper: { color: MUTED, fontSize: 12, lineHeight: 19, marginTop: 10 },
  cameraFrame: { height: 310, width: '100%', borderRadius: 12, overflow: 'hidden', backgroundColor: '#071321' },
  cameraPrompt: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', flex: 1 },
  primaryButton: { backgroundColor: TEAL },
  secondaryButton: { backgroundColor: '#26405a', borderColor: BORDER, borderWidth: 1 },
  buttonText: { fontSize: 13, fontWeight: '800', color: NAVY, textAlign: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  link: { color: TEAL, fontWeight: '800', marginBottom: 12 },
  toggleRow: { flexDirection: 'row', backgroundColor: '#0b192a', borderRadius: 10, padding: 3, marginBottom: 12 },
  toggle: { flex: 1, padding: 10, alignItems: 'center', borderRadius: 8 },
  toggleActive: { backgroundColor: '#284d61' },
  toggleLabel: { color: MUTED, fontSize: 12, fontWeight: '700' },
  toggleLabelActive: { color: WHITE },
  map: { width: '100%', aspectRatio: 640 / 192, backgroundColor: '#060b16', borderRadius: 8, overflow: 'hidden', justifyContent: 'center' },
  mapImage: { width: '100%', height: '100%' },
  crosshair: { position: 'absolute', width: 13, height: 13, borderRadius: 7, backgroundColor: 'transparent', borderWidth: 2, borderColor: '#ffffff', marginLeft: -6.5, marginTop: -6.5 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between' },
  smallNote: { fontSize: 12, color: MUTED, lineHeight: 17, marginTop: 10 },
  metricCard: { backgroundColor: '#0e2a3b', borderRadius: 12, borderWidth: 1, borderColor: '#316073', padding: 14, marginTop: 14 },
  metricLabel: { color: '#b1d7d9', fontSize: 12, fontWeight: '700' },
  bigMetric: { color: TEAL, fontWeight: '800', fontSize: 34, marginTop: 5 },
  meter: { fontSize: 20 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, paddingVertical: 14 },
  statLabel: { color: MUTED, fontSize: 10 },
  statValue: { color: WHITE, fontSize: 12, fontWeight: '800', marginTop: 5 },
  loading: { padding: 30, alignItems: 'center' },
  info: { color: WHITE, marginBottom: 14 },
  errorText: { color: '#fba8a8', marginTop: 10 },
  warning: { borderRadius: 14, backgroundColor: '#332a23', borderWidth: 1, borderColor: '#685441', padding: 14 },
  warningTitle: { color: '#ffd49b', fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  warningText: { color: '#eed7bf', fontSize: 12, lineHeight: 19, marginTop: 6 },
  gpsRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginTop: 6 },
  speedNumber: { color: TEAL, fontSize: 65, fontWeight: '900', fontVariant: ['tabular-nums'] },
  speedUnit: { color: WHITE, fontSize: 19, fontWeight: '800', marginLeft: 8 },
  footer: { color: '#6f849a', fontSize: 11, textAlign: 'center', marginTop: 20 },
});
