export const SITE_LAYOUTS = [
  {
    siteCode: "diamante",
    siteLabel: "Diamante",
    polygons: [
      {
        deviceCode: "matrix-emulator:diamante_pipa",
        polygonCode: "diamante_pipa",
        label: "Diamante PIPA",
        mapLabel: "Mapa Diamante",
      },
      {
        deviceCode: "matrix-emulator:diamante_footprint_hw",
        polygonCode: "diamante_footprint_hw",
        label: "FootPrint HW",
        mapLabel: "Mapa Diamante",
      },
      {
        deviceCode: "matrix-emulator:diamante_footprint_fw",
        polygonCode: "diamante_footprint_fw",
        label: "FootPrint FW",
        mapLabel: "Mapa Diamante",
      },
      {
        deviceCode: "matrix-emulator:diamante_bajo_diamante_esmeralda",
        polygonCode: "diamante_bajo_diamante_esmeralda",
        label: "Bajo Diamante Esmeralda",
        mapLabel: "Mapa Diamante",
      },
    ],
    plcMirrors: [
      { ip: "192.168.1.10", label: "PLC CD1 01" },
      { ip: "192.168.1.30", label: "PLC CD1 02" },
    ],
  },
];

export const SIGNAL_MATRIX = {
  "matrix-emulator:diamante_pipa": {
    normal: ["M1=1", "M2=0"],
    alerta: ["M1=0", "M2=1"],
    red: ["M1=0", "M2=1"],
    green: ["M1=1", "M2=0"],
  },
  "matrix-emulator:diamante_footprint_hw": {
    normal: ["M5=1", "M6=0"],
    alerta: ["M5=0", "M6=1"],
    red: ["M5=0", "M6=1"],
    green: ["M5=1", "M6=0"],
  },
  "matrix-emulator:diamante_footprint_fw": {
    normal: ["M3=1", "M4=0"],
    alerta: ["M3=0", "M4=1"],
    red: ["M3=0", "M4=1"],
    green: ["M3=1", "M4=0"],
  },
  "matrix-emulator:diamante_bajo_diamante_esmeralda": {
    inferior: ["M7=1", "M8=0", "M9=0"],
    centro: ["M7=0", "M8=1", "M9=0"],
    superior: ["M7=0", "M8=0", "M9=1"],
    green: ["M7=0", "M8=1", "M9=0"],
    red: ["M7=1/M9=1", "M8=0"],
  },
};
