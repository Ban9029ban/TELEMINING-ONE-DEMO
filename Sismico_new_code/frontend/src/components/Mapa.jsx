
export default function Mapa({ estado }) {
  const getColor = () => {
    switch (estado) {
      case "EMERGENCIA":
        return "rgba(255,0,0,0.5)";
      case "ALERTA":
        return "rgba(255,255,0,0.5)";
      default:
        return "rgba(0,255,0,0.5)";
    }
  };

  return (
    <div style={{
      width: "100%",
      height: "100%",
      background: getColor(),
      transition: "0.5s"
    }}>
      MAPA DIAMANTE
    </div>
  );
}
