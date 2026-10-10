/**
 * Utility for loading and caching Unicode fonts (Noto Sans) for jsPDF.
 * Supports NotoSans Regular and Bold with full Unicode coverage including the Nigerian Naira symbol (₦ U+20A6).
 */

let cachedRegularBase64: string | null = null;
let cachedBoldBase64: string | null = null;
let fontLoadPromise: Promise<{ regular: string; bold: string } | null> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * Loads the Unicode NotoSans fonts (Regular & Bold) as base64 strings.
 * Caches in memory for instant subsequent PDF generations.
 */
export async function loadPDFFonts(): Promise<{ regular: string; bold: string } | null> {
  if (cachedRegularBase64 && cachedBoldBase64) {
    return { regular: cachedRegularBase64, bold: cachedBoldBase64 };
  }

  if (fontLoadPromise) {
    return fontLoadPromise;
  }

  fontLoadPromise = (async () => {
    try {
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        const [regRes, boldRes] = await Promise.all([
          fetch('/fonts/NotoSans-Regular.ttf'),
          fetch('/fonts/NotoSans-Bold.ttf'),
        ]);

        if (!regRes.ok || !boldRes.ok) {
          console.warn('Failed to fetch NotoSans fonts from /fonts/', regRes.status, boldRes.status);
          return null;
        }

        const [regBuf, boldBuf] = await Promise.all([
          regRes.arrayBuffer(),
          boldRes.arrayBuffer(),
        ]);

        cachedRegularBase64 = arrayBufferToBase64(regBuf);
        cachedBoldBase64 = arrayBufferToBase64(boldBuf);

        return { regular: cachedRegularBase64, bold: cachedBoldBase64 };
      } else {
        // Node.js or SSR environment fallback
        try {
          const fs = await import('fs');
          const path = await import('path');
          const regPath = path.resolve(process.cwd(), 'public/fonts/NotoSans-Regular.ttf');
          const boldPath = path.resolve(process.cwd(), 'public/fonts/NotoSans-Bold.ttf');
          if (fs.existsSync(regPath) && fs.existsSync(boldPath)) {
            cachedRegularBase64 = fs.readFileSync(regPath).toString('base64');
            cachedBoldBase64 = fs.readFileSync(boldPath).toString('base64');
            return { regular: cachedRegularBase64, bold: cachedBoldBase64 };
          }
        } catch {
          // ignore in pure browser
        }
      }
    } catch (err) {
      console.warn('Error loading PDF fonts:', err);
    }
    return null;

  })();

  return fontLoadPromise;
}

/**
 * Synchronous getter if fonts are already loaded.
 */
export function getLoadedPDFFonts(): { regular: string; bold: string } | null {
  if (cachedRegularBase64 && cachedBoldBase64) {
    return { regular: cachedRegularBase64, bold: cachedBoldBase64 };
  }
  return null;
}
