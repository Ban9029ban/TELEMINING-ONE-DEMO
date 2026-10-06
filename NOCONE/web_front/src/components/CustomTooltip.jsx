const CustomTooltip = ({ active, payload }) => {
  if (active && payload && payload.length > 0) {
    const punto = payload[0].payload;
    return (
      <div style={{ backgroundColor: "#fff", padding: 10, border: "1px solid #ccc" }}>
        <strong>{punto.persona}</strong>
        <br />
        Tiempo: {punto.horas} h
      </div>);

  }
  return null;
};

export default CustomTooltip;