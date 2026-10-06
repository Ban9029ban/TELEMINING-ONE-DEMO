import React from 'react';
import ReactECharts from 'echarts-for-react';

const CHART_COLORS = [
'rgb(161, 161, 161)',
'rgb(255, 99, 132)',
'rgb(255, 159, 64)',
'rgb(255, 205, 86)',
'rgb(165,199,139)',
'rgb(120,196,166)',
'rgb(75, 192, 192)',
'rgb(54, 162, 235)',
'rgb(153, 102, 255)'];


const niveles = ['NP', 'UCL', 'NTI', 'SIN NIVEL'];

const VehiclePerLevelChart = ({ vehiclesPerLevel }) => {
  if (!vehiclesPerLevel) return <p>Cargando datos...</p>;

  // Extraer todos los tipos de vehículos únicos
  const tiposVehiculo = [...new Set(
    Object.values(vehiclesPerLevel).flatMap((nivelData) =>
    Object.keys(nivelData || {})
    )
  )];

  // Asegurar que todos los niveles tengan todos los tipos
  const formattedData = {};
  niveles.forEach((nivel) => {
    formattedData[nivel] = {};
    tiposVehiculo.forEach((tipo) => {
      formattedData[nivel][tipo] = vehiclesPerLevel[nivel]?.[tipo] || 0;
    });
  });

  // Preparar datasets
  const datasets = tiposVehiculo.map((tipo) => ({
    name: tipo,
    value: niveles.map((nivel) => formattedData[nivel][tipo])
  }));

  const series = datasets.map((item) => ({
    name: item.name,
    type: 'bar',
    stack: 'total',
    barWidth: '60%',
    data: item.value,
    itemStyle: {
      borderColor: '#fff',
      borderWidth: 1
    }
  }));

  const chartOptions = {
    tooltip: {
      trigger: 'item'
    },
    color: CHART_COLORS,
    title: {
      text: 'Vehículos por Nivel',
      right: 'center',
      textStyle: {
        color: '#757575', // gris oscuro
        fontSize: 20
        // sin bold
      }
    },
    legend: {
      show: false,
      backgroundColor: 'rgba(232, 232, 232, 0.8)',
      textStyle: {
        color: '#757575' // gris oscuro
        // sin bold
      }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: {
        color: '#8d8d8d' // gris oscuro
        // sin bold
      }
    },
    xAxis: {
      type: 'category',
      data: niveles,
      axisLabel: {
        show: true,
        interval: 0,
        color: '#8d8d8d' // gris oscuro
        // sin bold
      }
    },
    series
  };

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ReactECharts option={chartOptions} style={{ width: '100%', height: '100%' }} />
    </div>);

};

export default VehiclePerLevelChart;