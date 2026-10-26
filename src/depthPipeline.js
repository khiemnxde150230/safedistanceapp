/**
 * Offline photo-to-depth pipeline for the V11.6 trained student exported in V11.7.1.
 * Matches V11.8 preprocessing exactly: RGB / 255, NCHW, stretch to 640x192.
 * NOTE: Demo only; results are not calibrated for near-vehicle safety warnings.
 */
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { Buffer } from 'buffer';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-react-native';

// jpeg-js uses Node-style Buffer. Make the polyfill available in Hermes.
if (!global.Buffer) global.Buffer = Buffer;

export const WIDTH = 640;
export const HEIGHT = 192;
const PIXELS = WIDTH * HEIGHT;

// Metro needs static require() for models to be bundled into the iOS binary.
const MODELS = {
  metric_only: {
    label: 'Metric Only',
    resource: require('../assets/models/metric_only.onnx'),
  },
  metric_kd_grad: {
    label: 'Metric + KD + Gradient',
    resource: require('../assets/models/metric_kd_grad.onnx'),
  },
};

let cachedSession = null;
let cachedModelKey = null;

export function modelLabel(key) {
  return MODELS[key]?.label ?? key;
}

async function sessionFor(key) {
  const item = MODELS[key];
  if (!item) throw new Error('Unknown model: ' + key);
  if (cachedSession && cachedModelKey === key) return cachedSession;

  const asset = Asset.fromModule(item.resource);
  await asset.downloadAsync();
  const localUri = asset.localUri;
  if (!localUri) throw new Error('Không thể mở ONNX asset (localUri trống).');

  // Workaround for iOS packaged builds where ORT cannot open app-bundle file URLs.
  const folder = FileSystem.documentDirectory + 'onnx_models/';
  const folderInfo = await FileSystem.getInfoAsync(folder);
  if (!folderInfo.exists) await FileSystem.makeDirectoryAsync(folder, { intermediates: true });
  const destination = folder + key + '.onnx';
  const info = await FileSystem.getInfoAsync(destination, { size: true });
  if (!info.exists || info.size !== 750562) {
    if (info.exists) await FileSystem.deleteAsync(destination, { idempotent: true });
    await FileSystem.copyAsync({ from: localUri, to: destination });
  }

  // Explicitly start on CPU. Core ML can be investigated after iPhone benchmarking.
  let session;
  try {
    session = await ort.InferenceSession.create(destination, { executionProviders: ['cpu'] });
  } catch (e) {
    // Some iOS versions of ORT expect an absolute pathname rather than file:// URI.
    const path = decodeURI(destination.replace(/^file:\/\//, ''));
    session = await ort.InferenceSession.create(path, { executionProviders: ['cpu'] });
  }
  if (!session.inputNames?.length || !session.outputNames?.length) {
    throw new Error('ONNX model has no inputs or outputs.');
  }
  const previous = cachedSession;
  cachedSession = session;
  cachedModelKey = key;
  try { await previous?.release?.(); } catch (_) { /* older runtimes may omit release */ }
  return session;
}

function toCHWFromJpeg(base64) {
  const decoded = jpeg.decode(Buffer.from(base64, 'base64'), { useTArray: true });
  if (decoded.width !== WIDTH || decoded.height !== HEIGHT) {
    throw new Error(`Kích thước ảnh không khớp: ${decoded.width}x${decoded.height}`);
  }
  const rgba = decoded.data;
  const chw = new Float32Array(3 * PIXELS);
  for (let i = 0; i < PIXELS; i += 1) {
    const offset = i * 4;
    chw[i] = rgba[offset] / 255;
    chw[PIXELS + i] = rgba[offset + 1] / 255;
    chw[2 * PIXELS + i] = rgba[offset + 2] / 255;
  }
  return chw;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// Simple pseudo-color gradient: near = warm; far = cool. It is relative per image.
const COLORS = [
  [239, 68, 68],
  [255, 183, 77],
  [240, 230, 140],
  [84, 197, 189],
  [54, 102, 205],
];
function ramp(v) {
  const p = clamp(v, 0, 1) * (COLORS.length - 1);
  const i = Math.min(COLORS.length - 2, Math.floor(p));
  const t = p - i;
  const a = COLORS[i], b = COLORS[i + 1];
  return [0, 1, 2].map((k) => Math.round(a[k] * (1 - t) + b[k] * t));
}

function buildHeatmap(depth) {
  const samples = [];
  for (let i = 0; i < depth.length; i += 48) {
    if (Number.isFinite(depth[i])) samples.push(depth[i]);
  }
  if (samples.length === 0) throw new Error('Mô hình không trả về độ sâu hợp lệ.');
  samples.sort((a, b) => a - b);
  const low = samples[Math.floor(samples.length * 0.05)];
  const high = samples[Math.floor(samples.length * 0.95)];
  const denom = Math.max(0.01, high - low);
  const rgba = new Uint8Array(PIXELS * 4);
  for (let i = 0; i < PIXELS; i += 1) {
    const rgb = ramp((depth[i] - low) / denom);
    const off = i * 4;
    rgba[off] = rgb[0];
    rgba[off + 1] = rgb[1];
    rgba[off + 2] = rgb[2];
    rgba[off + 3] = 255;
  }
  // jpeg-js works in pure JS; photo inference (not 30 FPS live processing).
  const encoded = jpeg.encode({ data: rgba, width: WIDTH, height: HEIGHT }, 70);
  return {
    uri: 'data:image/jpeg;base64,' + Buffer.from(encoded.data).toString('base64'),
    low,
    high,
  };
}

export async function inferPhoto(uri, variant) {
  const started = Date.now();
  const manip = ImageManipulator.manipulate(uri);
  manip.resize({ width: WIDTH, height: HEIGHT });
  const imageRef = await manip.renderAsync();
  const prepared = await imageRef.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress: 0.92, base64: true });
  if (!prepared.base64) throw new Error('Không đọc được pixels từ ảnh sau khi resize.');
  const x = toCHWFromJpeg(prepared.base64);
  const prepMs = Date.now() - started;
  const session = await sessionFor(variant);
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const runStart = Date.now();
  const outputs = await session.run({ [inputName]: new ort.Tensor('float32', x, [1, 3, HEIGHT, WIDTH]) });
  const inferMs = Date.now() - runStart;
  const output = outputs[outputName];
  if (!output || output.data.length !== PIXELS) {
    throw new Error('Tensor đầu ra khác shape (1, 1, 192, 640) kỳ vọng.');
  }
  const depth = new Float32Array(output.data);
  for (let i = 0; i < PIXELS; i += 1) {
    if (!Number.isFinite(depth[i])) throw new Error('Depth map chứa NaN hoặc Infinity.');
  }
  const heat = buildHeatmap(depth);
  return {
    rgbUri: prepared.uri,
    heatUri: heat.uri,
    depth,
    low: heat.low,
    high: heat.high,
    selected: sampleDepth(depth, 0.5, 0.5),
    preprocessMs: prepMs,
    inferenceMs: inferMs,
    totalMs: Date.now() - started,
    variant,
  };
}

export function sampleDepth(depth, nx, ny) {
  const x = clamp(Math.floor(nx * WIDTH), 0, WIDTH - 1);
  const y = clamp(Math.floor(ny * HEIGHT), 0, HEIGHT - 1);
  return { x, y, nx: (x + 0.5) / WIDTH, ny: (y + 0.5) / HEIGHT, meters: Number(depth[y * WIDTH + x]) };
}
