import React from 'react';
import ReactECharts from 'echarts-for-react';

const PeoplePerLevelChart = ({ peoplePerLevel }) => {
  const niveles = ['NP', 'UCL', 'NTI', 'OFICINA TELEMINING'];
  const dataValues = niveles.map((nivel) => peoplePerLevel[nivel] || 0);

  const CHART_COLORS = [
  'rgb(54, 162, 235)',
  'rgb(161, 161, 161)',
  'rgb(255, 99, 132)',
  'rgb(255, 159, 64)',
  'rgb(255, 205, 86)',
  'rgb(165,199,139)',
  'rgb(120,196,166)',
  'rgb(75, 192, 192)',
  'rgb(153, 102, 255)'];


  const getChartOptions = () => ({
    tooltip: { trigger: 'item' },
    color: CHART_COLORS,
    title: {
      text: 'Personas ',
      right: 'center',
      textStyle: {
        color: '#757575', // gris oscuro igual que el otro componente
        fontWeight: 'bold',
        fontSize: 20
      }
    },
    legend: { show: false },
    xAxis: {
      type: 'category',
      data: niveles,
      axisLabel: {
        interval: 0,
        color: '#8d8d8d'
      }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: {
        color: '#8d8d8d'
      }
    },
    series: [
    {
      name: 'Personas',
      type: 'bar',
      barWidth: '60%',
      data: dataValues,
      itemStyle: { borderColor: '#fff', borderWidth: 1 }
    }]

  });

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ReactECharts option={getChartOptions()} style={{ width: '100%', height: '100%' }} />
    </div>);

};

export default PeoplePerLevelChart;