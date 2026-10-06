// ========================================================================
// CameraPanel.jsx – Módulo principal de video + detección
// ========================================================================

import React, { useEffect, useRef, useState } from "react";
import { runYOLOv5, drawDetections } from "../pages/Cameras/models.js";

export default function CameraPanel({ videoSrc, modelKey }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [isReady, setReady] = useState(false);

  // =============================================================
  // Reproducir video
  // =============================================================
  useEffect(() => {
    const video = videoRef.current;
    video.src = videoSrc;

    video.onloadeddata = () => {
      setReady(true);
      video.play();
    };
  }, [videoSrc]);

  // =============================================================
  // Bucle de inferencia
  // =============================================================
  useEffect(() => {
    if (!isReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    async function processFrame() {
      if (video.paused || video.ended) return;

      // dibujar frame temporal
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // extraer datos del frame
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const tensor = new ort.Tensor(
        "float32",
        new Float32Array(imgData.data.map((v) => v / 255)),
        [1, canvas.height, canvas.width, 4]
      );

      // correr detección
      const dets = await runYOLOv5(tensor, modelKey);

      // dibujar detecciones
      drawDetections(ctx, dets, canvas.width, canvas.height);

      requestAnimationFrame(processFrame);
    }

    requestAnimationFrame(processFrame);
  }, [isReady, modelKey]);

  return (
    <div>
            <video
        ref={videoRef}
        width="100%"
        style={{ display: "none" }}
        muted
        playsInline />
      

            <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          maxHeight: "380px",
          background: "black",
          borderRadius: "8px"
        }} />
      
        </div>);

}