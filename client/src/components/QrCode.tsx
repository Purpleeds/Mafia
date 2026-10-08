import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** A QR code rendered in the browser (dark on white, with a quiet zone, for reliable scanning). */
export function QrCode({ text, alt }: { text: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(text, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 480,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!src) return <div className="qr qr-placeholder" aria-hidden="true" />;
  return <img className="qr" src={src} alt={alt} width={240} height={240} />;
}
