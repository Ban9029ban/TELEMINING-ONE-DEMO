import React, { useEffect, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import axios from 'axios';
import { API_URL } from '../api-config';

const SensorChart = () => {
  const [chartData, setChartData] = useState(null);
  const [sensorData, setSensorData] = useState(null); // Nuevo estado para sensorData
  const token = localStorage.getItem("token");

  // Colores predefinidos
  const CHART_COLORS = [
  'rgb(75, 192, 192)', // azul claro
  'rgb(255, 99, 132)', // rojo
  'rgb(255, 159, 64)', // naranja
  'rgb(255, 205, 86)', // amarillo
  'rgb(165,199,139)', // oliva
  'rgb(120,196,166)', // cambridge
  'rgb(54, 162, 235)', // azul oscuro
  'rgb(153, 102, 255)' // prpura
  ];

  // Obtener datos del backend
  const fetchChartData = async () => {
    try {
      const response = await axios.get(`${API_URL}/control/graphics/grafic-data`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      // Acceder al campo correcto
      const sensorData = response.data.sensor_data;
      const criticalValues = response.data.critical_values;

      // Formatear datos para el grfico
      const formattedData = [];
      Object.entries(sensorData).forEach(([urName, data], index) => {
        formattedData.push({
          name: urName,
          type: 'line',
          data: data.values,
          smooth: true,
          itemStyle: {
            color: CHART_COLORS[index % CHART_COLORS.length] // Asignar colores diferentes a cada UR
          },
          markPoint: {
            symbolSize: 10,
            data: [
            {
              type: 'max',
              name: urName,
              label: {
                show: true,
                position: 'end' // Mostrar etiqueta en el extremo derecho
              }
            }]

          }
        });
      });

      // Agregar lmites crticos
      const criticalLines = [
      {
        name: 'Valor crítico superior',
        type: 'line',
        data: Array(formattedData[0]?.data.length).fill(criticalValues['Valor critico superior']),
        markLine: {
          symbol: 'none',
          label: {
            normal: {
              position: 'start',
              formatter: 'Valor crítico superior'
            }
          },
          lineStyle: {
            type: 'dashed',
            color: 'orange'
          },
          data: [{ yAxis: criticalValues['Valor critico superior'] }]
        }
      },
      {
        name: 'Valor crítico inferior',
        type: 'line',
        data: Array(formattedData[0]?.data.length).fill(criticalValues['Valor critico inferior']),
        markLine: {
          symbol: 'none',
          label: {
            normal: {
              position: 'start',
              formatter: 'Valor crítico inferior'
            }
          },
          lineStyle: {
            type: 'dashed',
            color: 'orange'
          },
          data: [{ yAxis: criticalValues['Valor critico inferior'] }]
        }
      }];


      console.log("Formatted Data:", formattedData); // Debugging

      setChartData({ series: [...formattedData, ...criticalLines] });
      setSensorData(sensorData); // Guardar sensorData en el estado
    } catch (error) {
      console.error('Error fetching sensor chart ', error);
    }
  };

  useEffect(() => {
    fetchChartData();
    const intervalId = setInterval(fetchChartData, 5000); // Actualizar cada 5 segundos
    return () => clearInterval(intervalId); // Limpiar intervalo al desmontar
  }, []);

  // Generar opciones del grfico
  const getChartOptions = () => {
    if (!chartData || !sensorData) return {};

    // Usar los timestamps del primer UR como ejemplo
    const timestamps = sensorData?.['UR ACC Rampa NP']?.timestamps || []; // Ajustar segn el nombre real de la UR

    return {
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        show: false,
        backgroundColor: 'rgba(232, 232, 232, 0.8)',
        textStyle: {
          color: '#000'
        }
      },
      title: {
        text: 'Grfico Valor sensor vs hora',
        left: 'center'
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: timestamps.map((timestamp) => {
          const date = new Date(timestamp);
          return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        })
      },
      yAxis: {
        type: 'value',
        name: 'Valor sensor'
      },
      series: chartData.series
    };
  };

  return (
    <div style={{ width: '100%', height: '400px' }}>
      {chartData && sensorData ?
      <ReactECharts option={getChartOptions()} style={{ width: '100%', height: '100%' }} /> :

      <p>Cargando datos...</p>
      }
    </div>);

};

export default SensorChart;