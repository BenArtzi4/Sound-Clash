import React, { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import '../../styles/components/qr-code.css';

interface QRCodeGeneratorProps {
  url: string;
  size?: number;
}

const QRCodeGenerator: React.FC<QRCodeGeneratorProps> = ({ url, size = 256 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        url,
        {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        },
        (error) => {
          if (error) {
            console.error('QR Code generation error:', error);
          }
        }
      );
    }
  }, [url, size]);

  return (
    <div className="qr-code-container">
      <canvas ref={canvasRef} />
    </div>
  );
};

export default QRCodeGenerator;
