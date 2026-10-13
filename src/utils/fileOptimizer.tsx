import React from 'react';
import heic2any from 'heic2any';

export interface OptimizationResult {
  file: File;
  originalSizeMB: number;
  optimizedSizeMB: number;
  isCompressed: boolean;
  warning?: string;
  error?: string;
}

export const optimizeFileBeforeUpload = async (file: File): Promise<OptimizationResult> => {
  const originalSizeMB = file.size / (1024 * 1024);
  let processFile = file;

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    if (originalSizeMB > 8) {
       return {
         file,
         originalSizeMB,
         optimizedSizeMB: originalSizeMB,
         isCompressed: false,
         warning: 'Dosyan büyük, tarayıcıda 200 DPI gri tonlama seç'
       };
    }
    return { file, originalSizeMB, optimizedSizeMB: originalSizeMB, isCompressed: false };
  }

  if (file.type === 'image/heic' || file.type === 'image/heif' || file.name.toLowerCase().endsWith('.heic')) {
    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: 'image/jpeg',
        quality: 0.78
      });
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      processFile = new File([blob], file.name.replace(/\.heic$/i, '.jpg'), { type: 'image/jpeg' });
    } catch (err) {
      return {
        file,
        originalSizeMB,
        optimizedSizeMB: originalSizeMB,
        isCompressed: false,
        error: 'HEIC formatı dönüştürülemedi. Lütfen geçerli bir resim yükleyin (veya cihazınızdan "En Uyumlu" seçeneğiyle aktarın).'
      };
    }
  }

  if (processFile.type.startsWith('image/') || processFile.name.toLowerCase().endsWith('.png') || processFile.name.toLowerCase().endsWith('.jpg') || processFile.name.toLowerCase().endsWith('.jpeg')) {
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(processFile);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        let width = img.width;
        let height = img.height;
        const MAX_SIZE = 2200;

        if (width > MAX_SIZE || height > MAX_SIZE) {
          if (width > height) {
            height = Math.round((height * MAX_SIZE) / width);
            width = MAX_SIZE;
          } else {
            width = Math.round((width * MAX_SIZE) / height);
            height = MAX_SIZE;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({ file: processFile, originalSizeMB, optimizedSizeMB: processFile.size / (1024*1024), isCompressed: false });
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            const ext = processFile.name.substring(processFile.name.lastIndexOf('.'));
            const newName = processFile.name.replace(new RegExp(`${ext}$`, 'i'), '.jpg');
            const newFile = new File([blob], newName, { type: 'image/jpeg' });
            resolve({
              file: newFile,
              originalSizeMB,
              optimizedSizeMB: newFile.size / (1024 * 1024),
              isCompressed: true
            });
          } else {
            resolve({ file: processFile, originalSizeMB, optimizedSizeMB: processFile.size / (1024*1024), isCompressed: false });
          }
        }, 'image/jpeg', 0.78);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ file: processFile, originalSizeMB, optimizedSizeMB: processFile.size / (1024*1024), isCompressed: false });
      };
      img.src = objectUrl;
    });
  }

  return { file, originalSizeMB, optimizedSizeMB: originalSizeMB, isCompressed: false };
};

export const OptimizationBadge: React.FC<{ stats: { orig: number, opt: number } | null }> = ({ stats }) => {
  if (!stats) return null;
  return (
    <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded-md text-xs font-medium ml-2 shadow-sm">
      <span className="flex items-center gap-1">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
        {stats.orig.toFixed(1)}MB &rarr; {stats.opt.toFixed(1)}MB
      </span>
    </div>
  );
};
