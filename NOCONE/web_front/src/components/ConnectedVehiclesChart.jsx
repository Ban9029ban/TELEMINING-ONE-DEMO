import React from "react";
import ReactECharts from "echarts-for-react";

const CHART_COLORS = [
"rgb(255, 99, 132)",
"rgb(255, 159, 64)",
"rgb(255, 205, 86)",
"rgb(165,199,139)",
"rgb(120,196,166)",
"rgb(75, 192, 192)",
"rgb(54, 162, 235)",
"rgb(153, 102, 255)",
"rgb(161, 161, 161)"];


export default function ConnectedVehiclesChart({
  vehicleStatus,
  title = "Vehículos conectados",
  hideInternalTitle = false
}) {
  const chartData = Object.entries(vehicleStatus || {}).map(([name, value]) => ({
    name,
    value
  }));

  const option = {
    tooltip: { trigger: "item" },
    color: CHART_COLORS,
    title: hideInternalTitle ?
    undefined :
    {
      text: title,
      right: "center",
      textStyle: {
        color: "#757575",
        fontWeight: "bold",
        fontSize: 20
      }
    },
    legend: { show: false },
    series: [
    {
      type: "pie",
      radius: ["40%", "70%"],
      itemStyle: { borderColor: "#fff", borderWidth: 3 },
      label: {
        color: "#8d8d8d",
        fontWeight: "bold"
      },
      data: chartData
    }]

  };

  return (
    <div style={{ width: "100%", height: "400px" }}>
      <ReactECharts option={option} style={{ width: "100%", height: "100%" }} />
    </div>);

}