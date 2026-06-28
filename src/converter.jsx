import React, { useState } from 'react';
import * as agPsd from 'ag-psd';
import "./index.css";

const fileTypes = [
  { value: 'pixil', label: 'pixil' },
  { value: 'ase', label: 'ase/aseprite' },
  { value: 'psd', label: 'psd' },
];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const aseBlendToCanvas = {
  0: 'source-over',
  1: 'multiply',
  2: 'screen',
  3: 'overlay',
  4: 'darken',
  5: 'lighten',
};

const canvasBlendToAse = {
  'source-over': 0,
  multiply: 1,
  screen: 2,
  overlay: 3,
  darken: 4,
  lighten: 5,
};

const psdBlendToCanvas = {
  normal: 'source-over',
  norm: 'source-over',
  multiply: 'multiply',
  mul: 'multiply',
  screen: 'screen',
  scrn: 'screen',
  overlay: 'overlay',
  over: 'overlay',
  darken: 'darken',
  dark: 'darken',
  lighten: 'lighten',
  lite: 'lighten',
};

const canvasBlendToPsd = {
  'source-over': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
};

class Reader {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.bytesView = new Uint8Array(buffer);
    this.pos = 0;
  }

  skip(n) { this.pos += n; }
  bytes(n) {
    const out = this.bytesView.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  string(n) { return textDecoder.decode(this.bytes(n)); }
  u8() { return this.view.getUint8(this.pos++); }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
}

class Writer {
  constructor() {
    this.bytes = [];
  }

  get length() { return this.bytes.length; }

  raw(data) {
  for (let i = 0; i < data.length; i++) {
      this.bytes.push(data[i]);
    }
  }
  u8(v) { this.bytes.push(v & 255); }

  i16(v) {
    const b = new ArrayBuffer(2);
    new DataView(b).setInt16(0, v, true);
    this.raw(new Uint8Array(b));
  }

  u16(v) {
    const b = new ArrayBuffer(2);
    new DataView(b).setUint16(0, v, true);
    this.raw(new Uint8Array(b));
  }

  u32(v) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, v, true);
    this.raw(new Uint8Array(b));
  }

  patchU32(offset, v) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, v, true);
    this.bytes.splice(offset, 4, ...new Uint8Array(b));
  }

  buffer() {
    return new Uint8Array(this.bytes).buffer;
  }
}

const makeBlankImageData = (width, height) => {
  return new ImageData(new Uint8ClampedArray(width * height * 4), width, height);
};

const imageDataToDataUrl = (imageData) => {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png', 1);
};

const dataUrlToImageData = (src, width, height) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    resolve(ctx.getImageData(0, 0, width, height));
  };
  img.onerror = () => reject(new Error('Could not read Pixil layer image.'));
  img.src = src;
});

const normalizeDoc = (doc) => ({
  ...doc,
  layers: doc.layers.map((layer, index) => ({
    name: layer.name || `Layer ${index + 1}`,
    visible: layer.visible !== false,
    opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
    blendMode: layer.blendMode || 'source-over',
    imageData: layer.imageData,
  })),
});

const composePreview = (doc) => {
  const canvas = document.createElement('canvas');
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  doc.layers.forEach((layer) => {
    if (!layer.visible) return;

    const layerCanvas = document.createElement('canvas');
    layerCanvas.width = doc.width;
    layerCanvas.height = doc.height;
    layerCanvas.getContext('2d').putImageData(layer.imageData, 0, 0);

    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;
    ctx.drawImage(layerCanvas, 0, 0);
  });

  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return ctx.getImageData(0, 0, doc.width, doc.height);
};

const extensionFor = (type) => type === 'ase' ? 'aseprite' : type;

const getFileType = (file) => {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pixil')) return 'pixil';
  if (name.endsWith('.psd')) return 'psd';
  if (name.endsWith('.ase') || name.endsWith('.aseprite')) return 'ase';
  return null;
};

const extractPalette = (doc) => {
  const colors = new Set();

  doc.layers.forEach((layer) => {
    const data = layer.imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      colors.add(
        [data[i], data[i + 1], data[i + 2]]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('')
      );
    }
  });

  return Array.from(colors);
};

const readPixil = async (file) => {
  const pixil = JSON.parse(await file.text());
  const width = Number(pixil.width);
  const height = Number(pixil.height);
  const frame = pixil.frames?.[pixil.currentFrame || 0] || pixil.frames?.[0];

  if (!width || !height || !frame?.layers?.length) {
    throw new Error('this pixil file does not contain readable layers');
  }

  const layers = await Promise.all(frame.layers.map(async (layer, index) => ({
    name: layer.name || `Layer ${index + 1}`,
    visible: layer.active !== false && layer.hidden !== true,
    opacity: Number(layer.opacity ?? 1),
    blendMode: layer.options?.blend || 'source-over',
    imageData: await dataUrlToImageData(layer.src, width, height),
  })));

  return normalizeDoc({
    name: pixil.name || file.name.replace(/\.[^.]+$/, ''),
    width,
    height,
    layers,
  });
};

const writePixil = (doc) => {
  const now = Date.now();
  const preview = imageDataToDataUrl(composePreview(doc));

  const pixil = {
    application: 'pixil',
    type: '.pixil',
    version: '2.7.0',
    website: 'pixilart.com',
    author: 'https://www.pixilart.com',
    contact: 'support@pixilart.com',
    width: String(doc.width),
    height: String(doc.height),
    colors: { default: extractPalette(doc) },
    colorSelected: 'default',
    frames: [{
      name: '',
      speed: 100,
      active: true,
      layers: doc.layers.map((layer, index) => ({
        id: index,
        src: imageDataToDataUrl(layer.imageData),
        edit: true,
        name: layer.name,
        opacity: String(layer.opacity),
        active: layer.visible,
        unqid: Math.random().toString(36).substring(2, 7),
        options: {
          blend: layer.blendMode,
          alpha_lock: false,
          locked: false,
          filter: {
            brightness: '100%',
            contrast: '100%',
            grayscale: '0%',
            blur: 0,
            'hue-rotate': 0,
            dropshadow_x: 0,
            dropshadow_y: 0,
            dropshadow_blur: 0,
            dropshadow_alpha: 1,
            dropshadow_color: '#000000',
          },
        },
      })),
    }],
    currentFrame: 0,
    currentLayer: 0,
    speed: 100,
    name: doc.name || 'drawing',
    preview,
    previewApp: '',
    palette_id: false,
    created_at: now,
    updated_at: now,
    id: now,
  };

  return new Blob([JSON.stringify(pixil)], { type: 'application/octet-stream' });
};

const inflateDeflate = async (bytes) => {
  if (!globalThis.DecompressionStream) {
    throw new Error('compressed aseprite files need a newer browser');
  }

  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

const layerToFullCanvas = (width, height, rgba, left, top, layerWidth, layerHeight) => {
  const full = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < layerHeight; y++) {
    for (let x = 0; x < layerWidth; x++) {
      const dstX = left + x;
      const dstY = top + y;
      if (dstX < 0 || dstY < 0 || dstX >= width || dstY >= height) continue;

      const src = (y * layerWidth + x) * 4;
      const dst = (dstY * width + dstX) * 4;
      full[dst] = rgba[src];
      full[dst + 1] = rgba[src + 1];
      full[dst + 2] = rgba[src + 2];
      full[dst + 3] = rgba[src + 3];
    }
  }

  return new ImageData(full, width, height);
};

const trimImageData = (imageData) => {
  const { width, height, data } = imageData;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    return { left: 0, top: 0, width: 1, height: 1, data: new Uint8ClampedArray(4) };
  }

  const outWidth = right - left + 1;
  const outHeight = bottom - top + 1;
  const out = new Uint8ClampedArray(outWidth * outHeight * 4);

  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      const src = ((top + y) * width + left + x) * 4;
      const dst = (y * outWidth + x) * 4;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
      out[dst + 3] = data[src + 3];
    }
  }

  return { left, top, width: outWidth, height: outHeight, data: out };
};

const readAseprite = async (file) => {
  const reader = new Reader(await file.arrayBuffer());

  reader.u32();
  if (reader.u16() !== 0xa5e0) throw new Error('not an aseprite file');

  const frameCount = reader.u16();
  const width = reader.u16();
  const height = reader.u16();
  const colorDepth = reader.u16();

  if (colorDepth !== 32) throw new Error('only rgba aseprite files are supported');

  reader.pos = 128;

  const layerDefs = [];
  const cels = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const frameStart = reader.pos;
    const frameBytes = reader.u32();

    if (reader.u16() !== 0xf1fa) throw new Error('invalid aseprite frame');

    const oldChunkCount = reader.u16();
    reader.skip(4);
    const chunkCount = reader.u32() || oldChunkCount;

    for (let i = 0; i < chunkCount; i++) {
      const chunkStart = reader.pos;
      const chunkSize = reader.u32();
      const chunkType = reader.u16();
      const chunkEnd = chunkStart + chunkSize;

      if (chunkType === 0x2004) {
        const flags = reader.u16();
        const layerType = reader.u16();
        reader.u16();
        reader.u16();
        reader.u16();
        const blendMode = reader.u16();
        const opacity = reader.u8();
        reader.skip(3);
        const name = reader.string(reader.u16());

        if (layerType === 0) {
          layerDefs.push({
            name,
            visible: Boolean(flags & 1),
            blendMode: aseBlendToCanvas[blendMode] || 'source-over',
            opacity: opacity / 255,
          });
        }
      }

      if (chunkType === 0x2005) {
        const layerIndex = reader.u16();
        const x = reader.i16();
        const y = reader.i16();
        const opacity = reader.u8() / 255;
        const celType = reader.u16();
        reader.i16();
        reader.skip(5);

        if (celType === 0 || celType === 2) {
          const celWidth = reader.u16();
          const celHeight = reader.u16();
          const raw = celType === 2
            ? await inflateDeflate(reader.bytes(chunkEnd - reader.pos))
            : reader.bytes(celWidth * celHeight * 4);

          cels.push({ layerIndex, x, y, opacity, celWidth, celHeight, raw });
        }
      }

      reader.pos = chunkEnd;
    }

    reader.pos = frameStart + frameBytes;
    break;
  }

  const layers = layerDefs.map((layer, index) => {
    const cel = cels.find((item) => item.layerIndex === index);

    return {
      ...layer,
      opacity: cel ? Math.min(layer.opacity, cel.opacity) : layer.opacity,
      imageData: cel
        ? layerToFullCanvas(width, height, cel.raw, cel.x, cel.y, cel.celWidth, cel.celHeight)
        : makeBlankImageData(width, height),
    };
  });

  if (!layers.length) throw new Error('no readable aseprite layers found');

  return normalizeDoc({
    name: file.name.replace(/\.[^.]+$/, ''),
    width,
    height,
    layers,
  });
};

const writeAseString = (writer, value) => {
  const bytes = textEncoder.encode(value);
  writer.u16(bytes.length);
  writer.raw(bytes);
};

const writeAseChunk = (writer, type, writeData) => {
  const start = writer.length;
  writer.u32(0);
  writer.u16(type);
  writeData();
  writer.patchU32(start, writer.length - start);
};

const writeAseprite = (doc) => {
  const writer = new Writer();

  writer.u32(0);
  writer.u16(0xa5e0);
  writer.u16(1);
  writer.u16(doc.width);
  writer.u16(doc.height);
  writer.u16(32);
  writer.u32(1);
  writer.u16(100);
  writer.u32(0);
  writer.u32(0);
  writer.u8(0);
  writer.raw(new Uint8Array(3));
  writer.u16(256);
  writer.u8(1);
  writer.u8(1);
  writer.i16(0);
  writer.i16(0);
  writer.u16(doc.width);
  writer.u16(doc.height);
  writer.raw(new Uint8Array(84));

  const frameStart = writer.length;
  writer.u32(0);
  writer.u16(0xf1fa);
  writer.u16(doc.layers.length * 2);
  writer.u16(100);
  writer.u16(0);
  writer.u32(doc.layers.length * 2);

  doc.layers.forEach((layer) => {
    writeAseChunk(writer, 0x2004, () => {
      writer.u16(layer.visible ? 1 : 0);
      writer.u16(0);
      writer.u16(0);
      writer.u16(doc.width);
      writer.u16(doc.height);
      writer.u16(canvasBlendToAse[layer.blendMode] ?? 0);
      writer.u8(Math.round(layer.opacity * 255));
      writer.raw(new Uint8Array(3));
      writeAseString(writer, layer.name);
    });
  });

  doc.layers.forEach((layer, index) => {
    const trimmed = trimImageData(layer.imageData);

    writeAseChunk(writer, 0x2005, () => {
      writer.u16(index);
      writer.i16(trimmed.left);
      writer.i16(trimmed.top);
      writer.u8(Math.round(layer.opacity * 255));
      writer.u16(0);
      writer.i16(0);
      writer.raw(new Uint8Array(5));
      writer.u16(trimmed.width);
      writer.u16(trimmed.height);
      writer.raw(trimmed.data);
    });
  });

  writer.patchU32(frameStart, writer.length - frameStart);
  writer.patchU32(0, writer.length);

  return new Blob([writer.buffer()], { type: 'application/octet-stream' });
};

const flattenPsdLayers = (children, out = []) => {
  children?.forEach((child) => {
    if (child.children?.length) {
      flattenPsdLayers(child.children, out);
    } else if (child.imageData || child.canvas) {
      out.push(child);
    }
  });

  return out;
};

const canvasToImageData = (canvas, width, height) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return ctx.getImageData(0, 0, width, height);
};

const readPsdFile = async (file) => {
  const psd = agPsd.readPsd(await file.arrayBuffer(), { useImageData: true });
  const layers = flattenPsdLayers(psd.children).map((layer, index) => ({
    name: layer.name || `Layer ${index + 1}`,
    visible: !layer.hidden,
    opacity: typeof layer.opacity === 'number' ? layer.opacity / 255 : 1,
    blendMode: psdBlendToCanvas[layer.blendMode] || 'source-over',
    imageData: layer.imageData || canvasToImageData(layer.canvas, psd.width, psd.height),
  }));

  if (!layers.length && psd.imageData) {
    layers.push({
      name: 'Background',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      imageData: psd.imageData,
    });
  }

  if (!layers.length) throw new Error('no readable psd layers found');

  return normalizeDoc({
    name: file.name.replace(/\.[^.]+$/, ''),
    width: psd.width,
    height: psd.height,
    layers,
  });
};

const writePsdFile = (doc) => {
  const psd = {
    width: doc.width,
    height: doc.height,
    children: doc.layers.map((layer) => ({
      name: layer.name,
      hidden: !layer.visible,
      opacity: Math.round(layer.opacity * 255),
      blendMode: canvasBlendToPsd[layer.blendMode] || 'normal',
      left: 0,
      top: 0,
      right: doc.width,
      bottom: doc.height,
      imageData: layer.imageData,
    })),
  };

  const bytes = agPsd.writePsd(psd, { useImageData: true });

  return new Blob([bytes], { type: 'application/octet-stream' });
};

const readDocument = async (file) => {
  const type = getFileType(file);

  if (type === 'pixil') return readPixil(file);
  if (type === 'ase') return readAseprite(file);
  if (type === 'psd') return readPsdFile(file);

  throw new Error('select an ase/aseprite, pixil, or psd file');
};

const writeDocument = (doc, outputType) => {
  if (outputType === 'pixil') return writePixil(doc);
  if (outputType === 'ase') return writeAseprite(doc);
  if (outputType === 'psd') return writePsdFile(doc);

  throw new Error('choose an output file type');
};

const Converter = () => {
  const [file, setFile] = useState(null);
  const [inputType, setInputType] = useState('pixil');
  const [outputType, setOutputType] = useState('ase');
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];

    if (!selectedFile) {
      setFile(null);
      return;
    }

    const realType = getFileType(selectedFile);

    if (realType !== inputType) {
      setError(`Please select a valid ${inputType.toUpperCase()} file`);
      setFile(null);
      setResult(null);
      return;
    }

    setFile(selectedFile);
    setError(null);
    setResult(null);
  };

  const convertFile = async () => {
    if (!file) return;

    setConverting(true);
    setError(null);

    try {
      const doc = await readDocument(file);
      const blob = writeDocument(doc, outputType);

      setResult({
        blob,
        fileName: `${file.name.replace(/\.[^.]+$/, '')}.${extensionFor(outputType)}`,
        width: doc.width,
        height: doc.height,
        layerCount: doc.layers.length,
      });
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setConverting(false);
    }
  };

  const downloadFile = () => {
    if (!result) return;

    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-8 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">pixil converter</h1>
      <p className="text-sm text-gray-600 mb-6">not affiliated with pixilart</p>

      <div className="space-y-4">
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <select
              value={inputType}
              onChange={(e) => {
                setInputType(e.target.value);
                setFile(null);
                setResult(null);
                setError(null);
              }}
              className="block w-full text-sm border border-gray-300 rounded p-2"
            >
              {fileTypes.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>

            <select
              value={outputType}
              onChange={(e) => {
                setOutputType(e.target.value);
                setResult(null);
                setError(null);
              }}
              className="block w-full text-sm border border-gray-300 rounded p-2"
            >
              {fileTypes.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>

          <input
            type="file"
            accept=".pixil,.ase,.aseprite,.psd"
            onChange={handleFileChange}
            className="block w-full text-sm border border-gray-300 rounded p-2"
          />
          {file && <p className="text-sm text-gray-600 mt-2">{file.name}</p>}
        </div>

        {error && (
          <div className="bg-red-100 border border-red-300 text-red-700 p-3 rounded text-sm">
            {error}
          </div>
        )}

        {file && !result && (
          <button
            onClick={convertFile}
            disabled={converting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded border-0 cursor-pointer font-medium"
          >
            {converting ? 'Converting...' : 'Convert'}
          </button>
        )}

        {result && (
          <div className="space-y-3">
            <div className="bg-green-100 border border-green-300 p-3 rounded text-sm">
              <p className="font-semibold mb-2">success</p>
              <p>{result.width}×{result.height}px, {result.layerCount} layers</p>
            </div>

            <button
              onClick={downloadFile}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded mr-2 border-0 cursor-pointer font-medium"
            >
              download
            </button>

            <button
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
              className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded border-0 cursor-pointer font-medium"
            >
              convert another
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Converter;