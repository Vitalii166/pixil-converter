import React, { useState } from 'react';
import './index.css';

const PngToPixilConverter = () => {
  const [file, setFile] = useState(null);
  const [converting, setConverting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const rgbToHex = (r, g, b, a = 255) => {
    if (a === 0) return 'transparent';
    return [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  };

  const extractPalette = (imageData) => {
    const { data } = imageData;
    const palette = new Set();
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a > 0) {
        const color = rgbToHex(r, g, b, a);
        palette.add(color);
      }
    }
    
    return Array.from(palette);
  };

  const imageDataToPngDataUrl = (imageData) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const createPixilFile = (imageData, palette, dataUrl) => {
    const { width, height } = imageData;
    
    const pixilFile = {
      application: "pixil",
      type: ".pixil",
      version: "2.7.0",
      website: "pixilart.com",
      author: "https://www.pixilart.com",
      contact: "support@pixilart.com",
      width: width,
      height: height,
      colors: {
        default: palette
      },
      colorSelected: "common",
      frames: [
        {
          name: "",
          speed: 100,
          layers: [
            {
              id: 0,
              src: dataUrl
            }
          ]
        }
      ]
    };
    
    return JSON.stringify(pixilFile);
  };

  const calculateResizeDimensions = (width, height, maxSize = 1024) => {
    if (width <= maxSize && height <= maxSize) {
      return { width, height, wasResized: false };
    }
    
    const aspectRatio = width / height;
    let newWidth, newHeight;
    
    if (width > height) {
      newWidth = maxSize;
      newHeight = Math.floor(maxSize / aspectRatio);
    } else {
      newHeight = maxSize;
      newWidth = Math.floor(maxSize * aspectRatio);
    }
    
    return { width: newWidth, height: newHeight, wasResized: true };
  };

  const loadImageFromFile = (file) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      
      reader.onload = (e) => {
        img.onload = () => {
          const { width, height, wasResized } = calculateResizeDimensions(img.width, img.height);
          
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, width, height);
          
          const imageData = ctx.getImageData(0, 0, width, height);
          resolve({ imageData, wasResized, originalWidth: img.width, originalHeight: img.height });
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile && selectedFile.type === 'image/png') {
      setFile(selectedFile);
      setError(null);
      setResult(null);
    } else {
      setError('Please select a valid PNG file');
      setFile(null);
    }
  };

  const convertToPixil = async () => {
    if (!file) return;
    
    setConverting(true);
    setError(null);
    
    try {
      const { imageData, wasResized, originalWidth, originalHeight } = await loadImageFromFile(file);
      const palette = extractPalette(imageData);
      const dataUrl = imageDataToPngDataUrl(imageData);
      const pixilContent = createPixilFile(imageData, palette, dataUrl);
      
      setResult({
        width: imageData.width,
        height: imageData.height,
        paletteSize: palette.length,
        content: pixilContent,
        fileName: file.name.replace('.png', '.pixil'),
        wasResized,
        originalWidth,
        originalHeight
      });
      
    } catch (err) {
      setError(`Error: ${err.message}`);
    } finally {
      setConverting(false);
    }
  };

  const downloadPixilFile = () => {
    if (!result) return;
    
    const blob = new Blob([result.content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
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
      <h1 className="text-2xl font-bold mb-2">PNG to PIXIL Converter</h1>
      <p className="text-sm text-gray-600 mb-6">Not affiliated with PixilArt</p>

      <div className="space-y-4">
        <div>
          <input
            type="file"
            accept="image/png"
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
            onClick={convertToPixil}
            disabled={converting}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-2 rounded border-0 cursor-pointer font-medium"
          >
            {converting ? 'Converting...' : 'Convert'}
          </button>
        )}

        {result && (
          <div className="space-y-3">
            <div className="bg-green-100 border border-green-300 p-3 rounded text-sm">
              <p className="font-semibold mb-2">Success!</p>
              {result.wasResized && (
                <p className="text-orange-700 mb-1">
                  Resized from {result.originalWidth}×{result.originalHeight}px (PixilArt max: 1024×1024)
                </p>
              )}
              <p>{result.width}×{result.height}px, {result.paletteSize} colors</p>
            </div>

            <button
              onClick={downloadPixilFile}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded mr-2 border-0 cursor-pointer font-medium"
            >
              Download
            </button>

            <button
              onClick={() => {
                setFile(null);
                setResult(null);
              }}
              className="bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded border-0 cursor-pointer font-medium"
            >
              Convert Another
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PngToPixilConverter;